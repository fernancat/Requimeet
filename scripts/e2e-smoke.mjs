#!/usr/bin/env node
/**
 * E2E integral de RequiMeet (dev). Requiere Postgres y LiveKit corriendo
 * (docker compose o contenedores requimeet-pg / requimeet-livekit).
 *
 * Levanta server (:3000) y processor (:4100) como procesos hijos, ejecuta el
 * recorrido completo con dos participantes sinteticos (rtc-node + socket.io)
 * y termina con codigo != 0 si algun paso falla. Los hijos siempre se matan.
 *
 * Uso: npm run test:e2e
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { io } = require('socket.io-client');
const {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
} = require('@livekit/rtc-node');

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API = 'http://localhost:3000/api';
const LIVEKIT_URL = 'ws://localhost:7880';
const INTERNAL_SECRET = 'dev-internal-secret';

const results = [];
let children = [];
let sockets = [];

function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`paso fallido: ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout esperando ${label}`);
    await sleep(150);
  }
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function connectSocket(token) {
  const socket = io('http://localhost:3000', {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

const emitAck = (s, ev, payload) => new Promise((r) => s.emit(ev, payload, r));
const once = (s, ev, ms = 20000) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ev}`)), ms);
    s.once(ev, (d) => {
      clearTimeout(t);
      resolve(d);
    });
  });

/** Publica un tono 440Hz en la sala hasta que se llame stop(). */
async function publishTone(token, identity) {
  const room = new Room();
  await room.connect(LIVEKIT_URL, token);
  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack(`${identity}-tone`, source);
  await room.localParticipant?.publishTrack(track, new TrackPublishOptions());
  let stopped = false;
  let phase = 0;
  const phaseStep = (2 * Math.PI * 440) / 48000;
  const pump = (async () => {
    while (!stopped) {
      const samples = new Int16Array(480);
      for (let s = 0; s < 480; s++) {
        samples[s] = Math.round(Math.sin(phase) * 12000);
        phase += phaseStep;
      }
      await source.captureFrame(new AudioFrame(samples, 48000, 1, 480));
    }
  })();
  pump.catch(() => {});
  return {
    room,
    stop: async () => {
      stopped = true;
      await room.disconnect().catch(() => {});
    },
  };
}

function spawnChild(name, command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[e2e] ${name} termino con codigo ${code}`);
    }
  });
  children.push(child);
  return child;
}

async function cleanup() {
  for (const s of sockets) s.disconnect();
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  await sleep(500);
  for (const c of children) {
    if (!c.killed) c.kill('SIGKILL');
  }
}

async function main() {
  // Arranque de hijos
  spawnChild('server', 'node', ['dist/main.js'], { cwd: path.join(ROOT, 'apps/server') });
  spawnChild('processor', 'node', ['dist/main.js'], {
    cwd: path.join(ROOT, 'apps/processor'),
    env: {
      ...process.env,
      INTERNAL_SHARED_SECRET: INTERNAL_SECRET,
      PROCESSOR_PORT: '4100',
      SERVER_INTERNAL_URL: 'http://localhost:3000',
    },
  });
  await waitFor(async () => {
    try {
      const res = await fetch(`${API}/meetings/healthcheck-no-existe`);
      return res.status === 404;
    } catch {
      return false;
    }
  }, 20000, 'server health');
  await waitFor(async () => {
    try {
      const res = await fetch('http://localhost:4100/sessions');
      return res.status === 401;
    } catch {
      return false;
    }
  }, 20000, 'processor health');
  step('arranque de server y processor', true);

  // a. host register/create/start
  const email = `e2e-${Date.now()}@example.com`;
  const reg = await api('POST', '/auth/register', {
    body: { email, password: 'password123', displayName: 'Host E2E' },
  });
  const hostToken = reg.json.accessToken;
  const meet = await api('POST', '/meetings', { token: hostToken, body: { title: 'E2E' } });
  const code = meet.json.code;
  const started = await api('POST', `/meetings/${code}/start`, { token: hostToken });
  step('a. host register/create/start', reg.status === 201 && started.status === 201, `code=${code}`);

  // host socket ANTES de las solicitudes (recibe join-request:new)
  const hostSocket = await connectSocket(hostToken);
  const hostSub = await emitAck(hostSocket, 'meeting:subscribe', { code });
  const hostChat = [];
  const processingResults = [];
  hostSocket.on('chat:message', (m) => hostChat.push(m));
  hostSocket.on('processing:result', (r) => processingResults.push(r));
  const joinNews = [];
  hostSocket.on('join-request:new', (p) => joinNews.push(p));

  // b. guests solicitan y quedan en espera
  const jrA = await api('POST', `/meetings/${code}/join-requests`, { body: { displayName: 'GuestA' } });
  const jrB = await api('POST', `/meetings/${code}/join-requests`, { body: { displayName: 'GuestB' } });
  const sockA = await connectSocket(jrA.json.guestToken);
  const sockB = await connectSocket(jrB.json.guestToken);
  const chatA = [];
  sockA.on('chat:message', (m) => chatA.push(m));
  const subA = await emitAck(sockA, 'meeting:subscribe', { code });
  const subB = await emitAck(sockB, 'meeting:subscribe', { code });
  step('b. guests en sala de espera (role waiting)', subA.role === 'waiting' && subB.role === 'waiting');

  await emitAck(hostSocket, 'chat:send', { body: 'mensaje de prueba waiting', clientRef: crypto.randomUUID() });
  await sleep(500);
  step('b. waiting NO recibe chat de la sala', chatA.length === 0);

  // c. host acepta A, rechaza B
  step('c. host recibio join-request:new x2', joinNews.length === 2, `${joinNews.length}`);
  const admittedA = once(sockA, 'meeting:admitted');
  const rejectedB = once(sockB, 'meeting:rejected');
  const acc = await api('POST', `/meetings/${code}/join-requests/${jrA.json.request.id}/accept`, { token: hostToken });
  const rej = await api('POST', `/meetings/${code}/join-requests/${jrB.json.request.id}/reject`, { token: hostToken });
  await admittedA;
  await rejectedB;
  step('c. A admitida y B rechazada', acc.status === 201 && rej.status === 201);

  // A se re-suscribe como participant
  const resubA = await emitAck(sockA, 'meeting:subscribe', { code });
  step('c. A re-suscribe como participant', resubA.role === 'participant');

  // d. A y host publican audio real; se escuchan entre si
  const mtA = await api('POST', `/meetings/${code}/media-token`, { token: jrA.json.guestToken });
  const mtH = await api('POST', `/meetings/${code}/media-token`, { token: hostToken });
  const pubA = await publishTone(mtA.json.token, 'guestA');
  const pubH = await publishTone(mtH.json.token, 'host');
  const aHearsHost = new Promise((r) => pubA.room.once(RoomEvent.TrackSubscribed, r));
  const hostHearsA = new Promise((r) => pubH.room.once(RoomEvent.TrackSubscribed, r));
  await Promise.all([aHearsHost, hostHearsA]);
  step('d. audio real cruzado (track subscribed en ambos lados)', true);

  // e. chat con dedupe
  const fixedRef = crypto.randomUUID();
  const hostGotChat = once(hostSocket, 'chat:message');
  const send1 = await emitAck(sockA, 'chat:send', { body: 'hola desde A', clientRef: fixedRef });
  await hostGotChat;
  const history = await api('GET', `/meetings/${code}/messages`, { token: hostToken });
  const send2 = await emitAck(sockA, 'chat:send', { body: 'hola desde A', clientRef: fixedRef });
  step(
    'e. chat persiste, llega al host y deduplica clientRef',
    send1.ok && send2.message?.id === send1.message?.id &&
      history.json.filter((m) => m.clientRef === fixedRef).length === 1,
  );

  // f. reconexion del socket de A
  sockA.disconnect();
  const sockA2 = await connectSocket(jrA.json.guestToken);
  sockets.push(sockA2);
  const resub2 = await emitAck(sockA2, 'meeting:subscribe', { code });
  const history2 = await api('GET', `/meetings/${code}/messages`, { token: jrA.json.guestToken });
  const ids = history2.json.map((m) => m.id);
  step(
    'f. reconexion: sigue participant e historial sin duplicados',
    resub2.role === 'participant' && new Set(ids).size === ids.length,
  );

  // h (antes del kick): el processor publica resultados demo con audioFrames > 0
  await waitFor(
    () => processingResults.find((r) => (r.payload?.audioFrames ?? 0) > 0),
    30000,
    'processing:result demo',
  );
  step('h. processing:result demo con audioFrames > 0', true);

  // g. kick de A
  const kickedA = once(sockA2, 'meeting:kicked');
  const participantsPayload = await new Promise((resolve) => {
    hostSocket.once('participants:list', resolve);
    hostSocket.emit('meeting:subscribe', { code }, () => {});
  });
  const pa = participantsPayload.participants.find((p) => p.displayName === 'GuestA');
  const kick = await api('POST', `/meetings/${code}/participants/${pa.id}/kick`, { token: hostToken });
  await kickedA;
  const mtAfterKick = await api('POST', `/meetings/${code}/media-token`, { token: jrA.json.guestToken });
  step('g. kick: meeting:kicked recibido y media-token pasa a 403', kick.status === 201 && mtAfterKick.status === 403);

  await pubA.stop();
  await pubH.stop();

  // i. fin de la reunion
  const hostEnded = once(hostSocket, 'meeting:ended');
  const ended = await api('POST', `/meetings/${code}/end`, { token: hostToken });
  await hostEnded;
  const mtAfterEnd = await api('POST', `/meetings/${code}/media-token`, { token: hostToken });
  const sessions = await fetch('http://localhost:4100/sessions', {
    headers: { 'x-internal-secret': INTERNAL_SECRET },
  });
  const sessionsJson = await sessions.json();
  step(
    'i. end: meeting:ended, media-token 409, sesiones del processor vacias',
    ended.status === 201 && mtAfterEnd.status === 409 && sessionsJson.length === 0,
  );
}

main()
  .then(async () => {
    console.log(`\nE2E OK: ${results.length}/${results.length} pasos`);
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(`\nE2E FALLO: ${err.message}`);
    console.error(`pasos: ${results.filter((r) => r.ok).length}/${results.length + 1}`);
    await cleanup();
    process.exit(1);
  });
