const { chromium } = require('playwright');
const { PrismaClient } = require(
  process.cwd() + '/node_modules/@prisma/client',
);
const fs = require('fs');
async function api(path, token, body) {
  const r = await fetch('http://localhost:3000/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw Error(JSON.stringify(data));
  return data;
}
(async () => {
  const host = await api('/auth/register', null, {
    email: `qa-${Date.now()}@test.local`,
    password: 'Test-requimeet-123!',
    displayName: 'Anfitrión de prueba',
  });
  const token = host.accessToken;
  const meeting = await api('/meetings', token, {
    title: 'Levantamiento de clientes y permisos',
  });
  await api(`/meetings/${meeting.code}/start`, token, {});
  const guest = await api(`/meetings/${meeting.code}/join-requests`, null, {
    displayName: 'Participante de prueba',
  });
  await api(
    `/meetings/${meeting.code}/join-requests/${guest.request.id}/accept`,
    token,
    {},
  );
  const db = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://requimeet:requimeet@localhost:55440/requimeet_qa',
      },
    },
  });
  const p = await db.participant.findFirst({
    where: { meetingId: meeting.id, hostUserId: host.user.id },
  });
  const segment = await db.transcriptSegment.create({
    data: {
      meetingId: meeting.id,
      participantId: p.id,
      resultId: 'qa-' + Date.now(),
      text: 'El sistema debe registrar clientes con correo único. Solo el administrador puede aprobar las solicitudes.',
      originalText: 'El sistema debe registrar clientes con correo único.',
      startMs: 0,
      endMs: 8500,
      createdAtMs: Date.now(),
    },
  });
  const req = await db.requirement.create({
    data: {
      meetingId: meeting.id,
      transcriptSegmentId: segment.id,
      sourceIds: [segment.id],
      text: segment.text,
      originalText: segment.text,
      status: 'APPROVED',
    },
  });
  await db.question.create({
    data: {
      meetingId: meeting.id,
      text: '¿Qué ocurre si el correo ya está registrado?',
      normalizedText: 'correo duplicado',
      reason:
        'Falta definir el mensaje de validación y el tratamiento de duplicados.',
      category: 'validations',
      priority: 'HIGH',
      sourceIds: [segment.id],
    },
  });
  const model = {
    entities: [
      {
        id: 'cliente',
        name: 'Cliente',
        sourceIds: [req.id],
        attributes: [
          {
            id: 'correo',
            name: 'correo electrónico',
            type: 'texto',
            required: true,
            identifier: true,
          },
        ],
      },
    ],
    relations: [],
  };
  const art = await db.artifact.create({
    data: {
      meetingId: meeting.id,
      kind: 'entities',
      content: model,
      sourceFingerprint: 'qa',
    },
  });
  const document = {
    title: meeting.title,
    entities: model,
    sections: [
      'scope',
      'roles',
      'requirements',
      'business_rules',
      'priorities',
      'acceptance',
      'contradictions',
      'pending',
    ].map((key) => ({
      key,
      items: [
        {
          text: 'El sistema registra clientes y permite revisar las solicitudes con trazabilidad.',
          sourceIds: [req.id],
        },
      ],
    })),
  };
  const doc = await db.artifact.create({
    data: {
      meetingId: meeting.id,
      kind: 'document',
      content: document,
      sourceFingerprint: 'qa',
    },
  });
  await db.meeting.update({
    where: { id: meeting.id },
    data: { selectedEntityId: art.id, selectedDocumentId: doc.id },
  });
  await db.$disconnect();
  fs.mkdirSync('/tmp/requimeet-browser-qa', { recursive: true });
  fs.writeFileSync(
    '/tmp/requimeet-browser-qa/session.json',
    JSON.stringify({ code: meeting.code, token }),
    { mode: 0o600 },
  );
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
      : {}),
    headless: true,
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    permissions: ['camera', 'microphone'],
  });
  await context.addInitScript(
    ({ token, code }) => {
      localStorage.setItem('requimeet.hostToken', token);
      sessionStorage.setItem(
        'requimeet.media.' + code,
        JSON.stringify({ audioEnabled: false, videoEnabled: false }),
      );
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 900;
        const c = canvas.getContext('2d');
        c.fillStyle = '#f4f7fa';
        c.fillRect(0, 0, 1600, 900);
        c.strokeStyle = '#2563eb';
        c.lineWidth = 20;
        c.strokeRect(20, 20, 1560, 860);
        c.fillStyle = '#123';
        c.font = '48px sans-serif';
        c.fillText('Pantalla completa de prueba — 1600 × 900', 70, 130);
        c.fillText('Esquinas y bordes deben permanecer visibles', 70, 230);
        window.qaCanvas = canvas;
        const stream = canvas.captureStream(10);
        setInterval(() => c.fillRect(100, 400, 10, 10), 100);
        return stream;
      };
    },
    { token, code: meeting.code },
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:5173/m/${meeting.code}`);
  await page
    .getByText('Conectado', { exact: true })
    .waitFor({ timeout: 20000 })
    .catch(async (e) => {
      console.log(
        'UI:',
        await page.locator('body').innerText(),
        'errors',
        errors,
      );
      await page.screenshot({ path: '/tmp/requimeet-browser-qa/error.png' });
      throw e;
    });
  const guestContext = await browser.newContext({
    viewport: { width: 768, height: 900 },
    permissions: ['camera', 'microphone'],
  });
  await guestContext.addInitScript(
    ({ code, token }) => {
      sessionStorage.setItem(
        'requimeet.guest.' + code,
        JSON.stringify({ token, displayName: 'Participante de prueba' }),
      );
      sessionStorage.setItem(
        'requimeet.media.' + code,
        JSON.stringify({ audioEnabled: false, videoEnabled: false }),
      );
    },
    { code: meeting.code, token: guest.guestToken },
  );
  const guestPage = await guestContext.newPage();
  await guestPage.goto(`http://localhost:5173/m/${meeting.code}`);
  await guestPage
    .getByText('Conectado', { exact: true })
    .waitFor({ timeout: 20000 });
  await page
    .getByRole('button', { name: 'Compartir pantalla', exact: true })
    .click();
  await page.locator('.screen-tile video').waitFor({ timeout: 15000 });
  await guestPage.locator('.screen-tile video').waitFor({ timeout: 15000 });
  const checks = [];
  for (const width of [360, 768, 1366, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `/tmp/requimeet-browser-qa/room-${width}.png`,
    });
    await page
      .getByRole('button', { name: 'Preguntas IA', exact: true })
      .click();
    await page.locator('.workspace-item').first().waitFor();
    checks.push({
      width,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      screenFit: await page
        .locator('.screen-tile video')
        .evaluate((e) => getComputedStyle(e).objectFit),
    });
    await page.screenshot({
      path: `/tmp/requimeet-browser-qa/panel-${width}.png`,
    });
    await page.getByRole('button', { name: 'Cerrar panel' }).click();
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.setViewportSize({ width: 683, height: 450 });
  await page.screenshot({ path: '/tmp/requimeet-browser-qa/zoom-200.png' });
  checks.push({
    zoom: 200,
    overflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`http://localhost:5173/meetings/${meeting.code}/review`);
  for (const tab of ['Requerimientos', 'Entidades', 'Documento final']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: `/tmp/requimeet-browser-qa/review-${tab.replaceAll(' ', '-')}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 360, height: 900 });
  await page.screenshot({
    path: '/tmp/requimeet-browser-qa/review-mobile.png',
    fullPage: true,
  });
  checks.push({
    reviewMobileOverflow: await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  });
  console.log(JSON.stringify({ checks, errors }));
  await browser.close();
  if (errors.length || checks.some((c) => c.overflow || c.reviewMobileOverflow))
    throw Error('Falló la verificación responsive');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
