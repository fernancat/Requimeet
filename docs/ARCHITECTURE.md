# RequiMeet — Arquitectura base

## 1. Arquitectura propuesta

Monolito modular NestJS + PostgreSQL, frontend React, LiveKit como SFU de
audio/video, Socket.IO como canal de tiempo real (admisión, chat, estado) y un
proceso `processor` separado **en el mismo repo** para consumo de medios.

¿Por qué corresponde al alcance? Tres semanas de desarrollo, equipo pequeño, y
una sola dependencia de infraestructura especializada (LiveKit). No hay
necesidad de microservicios, colas ni Redis: el estado temporal de conexión lo
mantiene LiveKit y el estado temporal de la app vive en memoria del gateway.

El `processor` es proceso separado por una razón técnica: el SDK de tiempo real
de LiveKit para servidor (`@livekit/rtc-node`) usa binarios nativos y mantiene
conexiones WebRTC por sala; aislarlo evita que un fallo de procesamiento
tumbe el backend de negocio. **No es un servicio de negocio**: no tiene base de
datos, no decide permisos; solo consume pistas y publica resultados al backend
por HTTP interno con secreto compartido.

## 2. Módulos y responsabilidades

Backend (`apps/server/src/modules`):

- `identity` — registro/login de anfitriones (JWT), sesiones de invitado
  (token opaco + JWT de corta duración). Controla `HostUser` y `GuestSession`.
- `meetings` — ciclo de vida (crear, iniciar, consultar, finalizar), sala de
  espera (solicitudes, admitir, rechazar), expulsar y silenciar. Controla
  `Meeting`, `JoinRequest`, `Participant`. Es el único módulo que decide
  autorización de reuniones.
- `livekit` — emisión de tokens con permisos mínimos y TTL corto, cliente de
  RoomService (silenciar/expulsar a nivel SFU), verificación de webhooks.
  No guarda estado de negocio.
- `chat` — historial persistente en PostgreSQL, deduplicación por `clientRef`,
  validación de longitud. Controla `ChatMessage`.
- `realtime` — gateway Socket.IO: autentica conexiones, suscribe a canales por
  reunión, retransmite eventos de los demás módulos. Sin lógica de negocio.
- `processing` — orquestación del processor: al iniciar/finalizar una reunión
  ordena iniciar/detener sesión, recibe resultados internos y los retransmite.

Frontend (`apps/web/src`): `pages` (login, dashboard, prejoin, lobby, sala),
`features/meeting` (hooks de LiveKit), `features/chat`, `lib/api` y
`lib/socket`.

Processor (`apps/processor/src`): `session` (conexión a sala, suscripciones,
buffers limitados, política drop-oldest), `consumers/demo` (cuenta frames y
emite resultados demo), `results` (cliente HTTP al backend).

## 3. Estructura de carpetas

```
apps/
  server/      # NestJS (puerto 3000)
  web/         # React + Vite (puerto 5173)
  processor/   # consumo de medios con @livekit/rtc-node (puerto 4100, interno)
packages/
  contracts/   # tipos compartidos: API, eventos RT, contrato multimedia
docs/
docker-compose.yml  # postgres + livekit server (dev)
```

## 4. Modelo mínimo de datos (Prisma/PostgreSQL)

- `HostUser(id, email, passwordHash, displayName, createdAt)`
- `Meeting(id, code UNIQUE, title, hostId, status[created|active|ended],
  createdAt, startedAt, endedAt)`
- `GuestSession(id, displayName, createdAt, expiresAt)` — sesión identificable
  de invitado; el nombre visible nunca es identidad ni permiso.
- `JoinRequest(id, meetingId, guestSessionId, displayName,
  status[pending|accepted|rejected|cancelled], createdAt, decidedAt, decidedBy)`
  — como mucho una `pending` por (meeting, sesión), garantizado en transacción.
- `Participant(id, meetingId, hostUserId?, guestSessionId?, displayName,
  role[host|participant], state[admitted|left|kicked], joinedAt, leftAt)`
- `ChatMessage(id, meetingId, authorParticipantId, authorName, body,
  clientRef, createdAt)` — UNIQUE(meetingId, authorParticipantId, clientRef).

Estados:
- **Persistente** (PostgreSQL): reuniones, participantes, solicitudes, chat.
- **Temporal de la app** (memoria del gateway): conexiones de socket, contador
  de no leídos, presencia en canal.
- **Estado en LiveKit**: conexiones WebRTC, pistas publicadas, mute real.
  Reconciliación: el webhook `participant_disconnected` nunca finaliza la
  reunión; al reconectar, el cliente pide `media-token` de nuevo y el backend
  revalida contra PostgreSQL. Si el backend reinicia, la sala sigue viva en
  LiveKit y los participantes renuevan token al expirar (TTL corto).

## 5. Endpoints y eventos principales

REST (`/api`, salvo webhook):
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `POST /meetings` (host) → `{ code, url }`
- `POST /meetings/:code/start` (host), `POST /meetings/:code/end` (host)
- `GET /meetings/:code` → info pública (estado, título)
- `POST /meetings/:code/join-requests` (público; crea GuestSession + solicitud)
- `DELETE /meetings/:code/join-requests` (invitado: cancelar la suya)
- `GET /meetings/:code/join-requests` (host)
- `POST /meetings/:code/join-requests/:id/accept|reject` (host)
- `POST /meetings/:code/media-token` (host o invitado **admitido**) → token LiveKit
- `POST /meetings/:code/participants/:id/mute` (host, solo silenciar)
- `POST /meetings/:code/participants/:id/kick` (host)
- `POST /meetings/:code/leave`
- `GET /meetings/:code/messages` (participante admitido)
- `POST /webhooks/livekit` (firma verificada, idempotente por `event.id`; se sirve
  bajo el prefijo global, ruta real `/api/webhooks/livekit`)
- Internos: `POST /internal/processing/results` (processor → backend)

Socket.IO (auth por JWT en handshake; room `meeting:<code>` solo tras admisión):
- C→S: `meeting:subscribe`, `join-request:cancel`, `chat:send` (ack), `chat:mark-read`
- S→C: `meeting:status`, `join-request:new|updated`, `meeting:admitted`,
  `meeting:rejected`, `meeting:ended`, `meeting:kicked`, `participants:list`,
  `chat:message`, `processing:result`, `error`

## 6. Recorridos

**Admisión**: invitado abre `/m/:code` → prejoin (nombre, preview, dispositivos)
→ `POST join-requests` → espera por socket (canal de la solicitud, sin acceso a
sala ni chat). El anfitrión recibe `join-request:new` → accept/reject (decisión
en transacción: si ya fue decidida, la segunda decisión es no-op idempotente).
Si accept: invitado recibe `meeting:admitted` → pide `media-token` → entra a
LiveKit y al canal de la reunión. La sala de espera es restricción real: el
token LiveKit solo se emite tras admisión y con revalidación en cada emisión.

**Ingreso del anfitrión**: crea la reunión, la inicia (status `active`) y pide
`media-token` directamente (rol host).

**Reconexión**: LiveKit reintenta solo; si el token expira, el cliente pide uno
nuevo a `media-token` (revalida: reunión activa, participante admitted, no
kicked). No se crean participantes ni solicitudes duplicadas: la admisión
reutiliza el `Participant` existente de la sesión.

**Expulsión**: host → `kick` → backend marca `kicked`, llama
`RoomService.removeParticipant`, emite `meeting:kicked`. LiveKit OSS **no
revoca tokens ya emitidos**; mitigación: TTL de token corto (5 min) con
renovación revalidada + bloqueo de nuevas solicitudes de esa sesión (kick
persistente en PostgreSQL). Ventana residual ≤ TTL, documentada.

**Finalización**: solo host → status `ended`, `endedAt`, se emite
`meeting:ended`, se borra la sala en LiveKit (`deleteRoom`, desconecta a
todos) y se detiene el processor. Nuevos ingresos y tokens se rechazan.

**Host pierde conexión**: la reunión sigue `active`; al volver entra con su
sesión y `media-token`. Nada la finaliza automáticamente.

## 7. Contrato de consumo de audio/video

Ver `packages/contracts/src/media.ts`. Resumen:
- El backend inicia el procesamiento al activar la reunión: emite un token
  LiveKit para un participante oculto (`canSubscribe`, sin publicar) y llama
  `POST <processor>/sessions` con `{ meetingId, roomName, livekitUrl,
  processorToken, enableVideo }`.
- El processor se une a la sala, suscribe pistas (audio siempre; video solo si
  `enableVideo`), y alimenta a los `MediaConsumer` registrados.
- `AudioFrame`: PCM16, `sampleRateHz`, `channels`, `durationMs`, `mediaTimeMs`
  (tiempo del medio) y `receivedAtMs` (hora de recepción; **sin promesa de
  sincronización exacta** entre participantes).
- `VideoFrame`: `width`, `height`, `format` (p.ej. i420), mismos tiempos.
- Resultados: `ProcessingResult` con `resultId`, `replacesResultId`,
  `kind: demo|transcript-partial|transcript-final|analysis`, `isFinal` — listo
  para que Deepgram corrija parciales sin duplicar.
- Buffers limitados (p.ej. 50 frames) con política **drop-oldest** y contador
  de descartes; un error en un consumidor se registra y no afecta la llamada.
- Reconexión del processor sin consumidores duplicados: las suscripciones se
  recrean por `trackSid` y la sesión anterior se cierra siempre.
- No se guarda audio/video por defecto; nada de frames en logs.
- Quién inicia: automático al iniciar la reunión (el anfitrión lo inicia al
  crear/arrancar). Los participantes ven `processing:result` y la UI muestra
  un indicador "análisis de demostración activo".
- **Demo**: `DemoConsumer` cuenta frames de audio por participante y emite un
  resultado `kind:'demo'` cada 10 s. No es transcripción.

## 8. Orden de implementación (rama enumerada por paso)

1. `feat/01-repo-scaffold` — monorepo, contratos, docs, compose.
2. `feat/02-identity-auth` — host auth + sesiones de invitado.
3. `feat/03-meetings-admission` — ciclo de vida + sala de espera + tests.
4. `feat/04-livekit-integration` — tokens, RoomService, webhook.
5. `feat/05-realtime-chat` — gateway Socket.IO + chat persistente + tests.
6. `feat/06-media-processor` — processor + contrato + DemoConsumer.
7. `feat/07-web-prejoin-lobby` — auth UI, prejoin, sala de espera.
8. `feat/08-web-meeting-room` — sala, grid, controles propios, chat UI.
9. `feat/09-host-controls` — admitir/rechazar/silenciar/expulsar/finalizar UI.
10. `feat/10-tests-hardening` — rate limiting, logging, README, verificación.

## Decisiones declaradas

- Historial de chat: un participante recién admitido **sí ve** los mensajes
  anteriores de la reunión (regla simple aplicada en backend).
- Compartir pantalla: una presentación activa a la vez; una segunda solicitud
  se rechaza con aviso hasta que la actual termine (el anfitrión no tiene
  prioridad especial).
- Audio del sistema al compartir pantalla depende del navegador
  (`getDisplayMedia({audio:true})` solo en Chromium con pestaña/pantalla
  compatible); la UI lo expone como opción "si el navegador lo permite".
- Silenciar participante = `RoomService.updateParticipant(muted)` a nivel SFU;
  el anfitrión **no puede** activar micrófono/cámara ajenos (el SDK no lo
  permite y no se ofrece en la API).
- Rate limiting básico en solicitudes de ingreso y mensajes (en memoria, por
  IP/sesión), documentado como mecanismo de desarrollo, no anti-DDoS.

## Revisión del levantamiento
MeetingAccessService centraliza lectura de admitidos durante una reunión activa y administración exclusiva del propietario, incluso al terminar. Los requerimientos tienen versión optimista, fuentes múltiples, descarte reversible e historial. Aprobar no permite editar: primero se reabre a PENDING. Los cambios persistidos notifican workspace:changed; los clientes consultan el estado autorizado por REST.

## Artefactos del levantamiento
Artifact almacena propuestas separadas, contenido estructurado, versión optimista e historial. Meeting conserva el modelo seleccionado. La huella de fuentes detecta cambios posteriores; generar nunca reemplaza la selección existente. Entidades y relaciones solo referencian requerimientos aprobados; la UI edita formularios y renderiza el mismo SVG determinista que utilizarán las exportaciones.
