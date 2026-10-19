# RequiMeet — Integración de módulos futuros

Punto de extensión real del proyecto: el pipeline multimedia del processor.
Este documento indica **dónde** conectar cada módulo futuro y **con qué
contrato**, sin tocar el core de reuniones.

## Tabla de puntos de extensión

| Módulo futuro | Punto de extensión | Contrato |
|---|---|---|
| Transcripción (Deepgram) | Nuevo `MediaConsumer` en `apps/processor/src/consumers/`, registrado en `apps/processor/src/main.ts` (`sessionFactory`) | `AudioFrame` (PCM16, 48kHz) de `packages/contracts/src/media.ts`; resultados `kind: 'transcript-partial' \| 'transcript-final'` con `resultId`/`replacesResultId` |
| Preguntas IA | Consumir los resultados en el server (listener `@OnEvent('livekit.event')` no aplica; suscribirse al flujo de `InternalProcessingController` o persistir resultados y consultarlos) | `ProcessingResult` de `media.ts`; evento RT `processing:result` |
| Requerimientos / minutas | Igual que preguntas IA: agregación de `transcript-final` por reunión | `ProcessingResult.payload` + `Meeting`/`Participant` en PostgreSQL |
| Diagramas / exportación | Lectura de PostgreSQL (reuniones, participantes, chat) + resultados persistidos si se decide | Tablas Prisma (`apps/server/prisma/schema.prisma`) |

## Cómo añadir un consumidor (ej. transcripción)

1. Crear `apps/processor/src/consumers/deepgram-consumer.ts` implementando
   `MediaConsumer` (`packages/contracts/src/media.ts`):
   - `onAudioFrame(frame)`: enviar PCM16 al stream de Deepgram.
   - Publicar resultados con `kind: 'transcript-partial'` (parciales,
     `isFinal: false`) y luego `transcript-final` (`isFinal: true`,
     `replacesResultId` apuntando al parcial que corrige — la UI reemplaza sin
     duplicar la frase).
2. Registrarlo en `apps/processor/src/main.ts` dentro de `sessionFactory`,
   junto al `DemoConsumer`.
3. El resultado viaja solo: processor → `POST /api/internal/processing/results`
   (con `x-internal-secret`) → server retransmite `processing:result` por
   Socket.IO a `meeting:<code>` → la UI lo muestra.

El processor ya garantiza: buffers acotados con drop-oldest (50 frames),
aislamiento de errores por consumidor (una excepción no tumba la sesión),
reconexión sin consumidores duplicados (keyed por `trackSid`) y reintentos
con backoff al publicar resultados.

## Reglas del contrato que hay que respetar

- `mediaTimeMs` es tiempo del medio acumulado por pista; `receivedAtMs` es
  hora local. **No** hay sincronización exacta entre participantes: alinear
  pistas para análisis cruzado requiere sincronización aparte.
- Identidad: `ParticipantRef.participantId` es el `Participant.id` interno
  (estable); `livekitIdentity` solo correlaciona con LiveKit.
- Nada de audio/video se persiste por defecto; no loguear frames (solo
  contadores e ids).
- Los resultados son prescindibles por diseño (drop con log tras 3 intentos);
  si un módulo necesita durabilidad, debe persistirlos explícitamente en el
  server.

## Transcripción persistente (20)
Los resultados usan resultId estable y revision incremental. TranscriptsService guarda parciales y finales; solo los finales emiten transcript.confirmed. GET /meetings/:code/transcripts recupera páginas de 100 segmentos. El propietario puede corregir finales con PATCH y versión esperada. Se conserva original e historial. El cierre espera al processor hasta 15 segundos antes de borrar la sala; resultados tardíos se aceptan durante 30 segundos desde endedAt. El buffer de audio es acotado: una caída prolongada puede dejar fragmentos incompletos, nunca se presentan como confirmados.
