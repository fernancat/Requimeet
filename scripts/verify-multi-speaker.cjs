/** Real provider smoke test. Input: public base URL, Spanish 48kHz mono PCM16 clip.
 * Uses a separate meeting; never records participants or prints tokens. */
const fs = require('node:fs');
const { Room, AudioSource, AudioFrame, LocalAudioTrack, TrackPublishOptions, TrackSource } = require('@livekit/rtc-node');
const { io } = require('socket.io-client');
const base = process.argv[2], file = process.argv[3];
if (!base || !file) throw Error('Usage: node scripts/verify-multi-speaker.cjs <url> <48k-mono-s16le.pcm>');
const pcm = fs.readFileSync(file), sleep = ms => new Promise(r => setTimeout(r, ms));
let host, code, socket; const clients = []; const events = [];
async function api(path, token, body) {
  const r = await fetch(base + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': '1', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error(path + ': HTTP ' + r.status); return r.json();
}
async function until(check, label, ms=45000) { const end=Date.now()+ms; while(Date.now()<end){if(await check())return;await sleep(500)}throw Error('Timeout: '+label); }
async function connect(token, label) {
  const media = await api(`/meetings/${code}/media-token`, token, {});
  const room = new Room(); clients.push(room); await room.connect(media.livekitUrl, media.token);
  const source = new AudioSource(48000, 1);
  const track = LocalAudioTrack.createAudioTrack(label, source);
  await room.localParticipant.publishTrack(track, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
  return { room, source, id: room.localParticipant.identity, label };
}
async function speak(client, previous=0) {
  for(let i=0;i<250;i++)await client.source.captureFrame(new AudioFrame(new Int16Array(480),48000,1,480));
  await sleep(1000);
  for(let i=0;i<pcm.length;i+=960){const data=new Int16Array(480);const chunk=pcm.subarray(i,i+960);for(let j=0;j+1<chunk.length;j+=2)data[j/2]=chunk.readInt16LE(j);await client.source.captureFrame(new AudioFrame(data,48000,1,480));}
  for(let i=0;i<180;i++)await client.source.captureFrame(new AudioFrame(new Int16Array(480),48000,1,480));
  await until(async()=>{const x=await api(`/meetings/${code}/transcripts`,host);return x.items.filter(s=>s.participantId===client.id&&s.isFinal).length>previous},client.label+' transcripción final');
  console.log('PASS voz→transcripción final',client.label);
}
(async()=>{
 try {
  host=(await api('/auth/register',null,{email:`qa-multi-${Date.now()}@example.com`,password:require('crypto').randomBytes(20).toString('hex'),displayName:'QA voces'})).accessToken;
  code=(await api('/meetings',host,{title:'QA aislado: tres voces y reconexión'})).code;console.log('QA room',code);
  await api(`/meetings/${code}/start`,host,{});
  socket=io(base,{auth:{token:host},transports:['websocket'],extraHeaders:{'ngrok-skip-browser-warning':'1'}});
  await new Promise((r,j)=>{socket.on('connect',r);socket.on('connect_error',j)});
  await new Promise(r=>socket.emit('meeting:subscribe',{code},r));
  socket.on('processing:result',e=>{if(e.kind==='transcript-final')events.push(e.participantId)});
  const tokens=[host];
  for(let i=1;i<=2;i++){const join=await api(`/meetings/${code}/join-requests`,null,{displayName:'QA invitado '+i});await api(`/meetings/${code}/join-requests/${join.request.id}/accept`,host,{});tokens.push(join.guestToken)}
  const speakers=[];
  for(let i=0;i<3;i++){const client=await connect(tokens[i],'voz-'+i);speakers.push(client);await speak(client)}
  const old=speakers[1];const before=(await api(`/meetings/${code}/transcripts`,host)).items.filter(s=>s.participantId===old.id&&s.isFinal).length;
  await old.room.disconnect();const renewed=await connect(tokens[1],'voz-1-reconectada');await speak(renewed,before);
  // Opt-in recovery probe: stop only this test meeting's processor session.
  if (process.env.QA_RECOVERY === '1') {
    const env = require('dotenv').parse(fs.readFileSync('.env'));
    const internal = env.PROCESSOR_INTERNAL_URL || 'http://localhost:4100';
    const headers = { 'x-internal-secret': env.INTERNAL_SHARED_SECRET };
    const sessions = async () => { const r = await fetch(internal + '/sessions', { headers, signal: AbortSignal.timeout(5000) }); if (!r.ok) throw Error('processor status ' + r.status); return r.json(); };
    const oldSession = (await sessions()).find(s => s.roomName === code);
    if (!oldSession) throw Error('QA session missing before recovery');
    const stopped = await fetch(internal + '/sessions/' + oldSession.meetingId, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) });
    if (!stopped.ok) throw Error('QA session stop failed');
    await until(async () => (await sessions()).some(s => s.roomName === code && s.startedAtMs !== oldSession.startedAtMs && s.connectionState === 'connected'), 'recuperación automática', 60000);
    const count = (await api(`/meetings/${code}/transcripts`,host)).items.filter(s => s.participantId === renewed.id && s.isFinal).length;
    await speak(renewed, count);
    console.log('PASS recuperación automática sin salir de la sala');
  }
  await until(async()=>{const x=await api(`/meetings/${code}/analysis`,host);return x.jobs.some(j=>j.status==='completed')},'IA completa',60000);
  if(new Set(events).size!==3)throw Error('Eventos públicos incompletos: '+new Set(events).size);
  console.log('PASS Socket.IO ngrok: tres participantes; IA completada; reconexión con nueva pista');
 } finally {
  socket?.disconnect();
  for(const room of clients)await Promise.race([room.disconnect().catch(()=>{}),sleep(4000)]);
  if(code&&host)await api(`/meetings/${code}/end`,host,{});
 }
})().then(()=>process.exit(0)).catch(e=>{console.error(e.message, e.cause?.code ?? '', e.cause?.errors?.map(x => x.code) ?? '');process.exit(1)});
