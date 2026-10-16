# Transcripción en vivo con Deepgram

Documento técnico de los cambios realizados en RequiMeet para incorporar
**transcripción de voz en tiempo real** por participante, mostrada en vivo en la
sala de reunión.

---

## 1. Resumen

Antes de este cambio el proyecto ya tenía todo el andamiaje de procesamiento
multimedia (sesión oculta en LiveKit, pipeline de consumidores, publicación de
resultados al backend y retransmisión por Socket.IO) pero **ningún consumidor
real de transcripción**: solo existía el `DemoConsumer` de ejemplo.

El cambio agrega un **`MediaConsumer` que habla con Deepgram** para convertir el
audio de cada participante en texto en vivo, y la interfaz en el frontend para
verlo dentro de la sala. No se tocó el backend ni los contratos: el "transporte"
de resultados ya existía.

Resultado: al abrir el panel **Transcripción** en una reunión, aparece el texto
que habla cada participante, con su nombre y la marca de tiempo, reemplazando
los fragmentos parciales por la versión final de cada frase.

## 2. Flujo de datos (de extremo a extremo)

```
Micrófono del participante
        │  (LiveKit transporta la pista de audio)
        ▼
MediaSession (apps/processor)          <-- ya existía
  · se une como participante oculto
  - suscribe cada track de audio
  - emite AudioFrame (PCM16) a los consumidores
        │
        ▼
DeepgramConsumer  (NUEVO)
  - 1 WebSocket a Deepgram por cada track (trackSid)
  - envia PCM16 crudo
  - recibe JSON con transcript / is_final / speech_final
  - emite ProcessingResult (transcript-partial / transcript-final)
        |
        v
ResultsClient  ->  POST /api/internal/processing/results   (x-internal-secret)
                            |
                            v
  apps/server: InternalProcessingController  (SIN cambios)
        -> valida y retransmite por Socket.IO el evento processing:result
           a la sala meeting:<code>
                                   |
                                   v
     apps/web MeetingRoomPage -> applyTranscriptResult -> TranscriptPanel
```

Nota: el backend y el `InternalProcessingController` **ya existían** y ya
aceptaban `kind: 'transcript-partial' | 'transcript-final'`; no requirieron
cambios.

## 3. Archivos creados

### 3.1 `apps/processor/src/consumers/deepgram-consumer.ts` (nuevo)

Consumidor `MediaConsumer` que mantiene **un WebSocket de Deepgram por pista de
audio**. Un stream por participante permite separar quién habla y publicar
resultados con su `participantId`.

Puntos clave:

- Baja audio desde el pipeline: `onAudioFrame(frame)` convierte los `Int16Array`
  a `Buffer` PCM16 y los envía por el socket del track.
- Abre el socket bajo demanda (primer frame de cada `trackSid`):

```
wss://api.deepgram.com/v1/listen
  ?model=nova-2
  &language=es
  &encoding=linear16
  &sample_rate=<Hz del frame>
  &channels=<canales>
  &interim_results=true
  &endpointing=300
  &smart_format=true
  Authorization: Token <DEEPGRAM_API_KEY>
```

- Interpreta los mensajes de Deepgram (`channel.alternatives[0].transcript`,
  `is_final`, `speech_final`, `start`, `duration`).
- Publica dos tipos de resultado:
  - `transcript-partial` (`isFinal: false`): texto provisional que se va
    reemplazando. Cada parcial apunta al anterior vía `replacesResultId`.
  - `transcript-final` (`isFinal: true`): frase definitiva; también reemplaza al
    último parcial, de modo que la UI no duplica la frase.
- Acumula fragmentos `is_final` hasta que Deepgram marca `speech_final`, para
  emitir la frase completa.
- KeepAlive: cada 5 s envía `{"type":"KeepAlive"}` en los streams sin audio
  reciente, para que Deepgram no cierre la conexión por inactividad.
- Cierre: cierra el socket al despublishar la pista (`onTrackUnpublished`) y al
  terminar la sesión (`onSessionEnd`).
- Si `DEEPGRAM_API_KEY` no está configurada, el consumidor ni se registra y el
  resto del sistema sigue funcionando igual.

### 3.2 `apps/processor/src/deepgram-consumer.spec.ts` (nuevo)

7 pruebas unitarias con un socket falso (sin red): un stream por track,
reemplazo de parciales por `replacesResultId`, acumulación hasta `speech_final`,
aislamiento entre participantes, `speech_final` sin texto, cierre en
`onTrackUnpublished`/`onSessionEnd` y tolerancia a JSON inválido.

### 3.3 `apps/web/src/features/transcript/transcript-store.ts` (nuevo)

Estado puro de la transcripción en el cliente. Expone `applyTranscriptResult`
y el tipo `TranscriptSegment`:

```ts
interface TranscriptSegment {
  resultId: string;
  participantId: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
  isFinal: boolean;
}
```

`applyTranscriptResult` ignora resultados que no sean de transcripción,
reemplaza el segmento indicado por `replacesResultId` (o inserta uno nuevo) y
así convierte los parciales en final sin duplicar.

### 3.4 `apps/web/src/features/transcript/transcript-store.test.ts` (nuevo)

Pruebas del store (reemplazo por `replacesResultId`, inserción, filtrado por
`kind`).

### 3.5 `apps/web/src/features/transcript/TranscriptPanel.tsx` (nuevo)

Panel de UI que muestra los segmentos en vivo:
- Nombre del participante (resuelto desde `participants` por `participantId`).
- Marca de tiempo `mm:ss` a partir de `startMs`.
- Etiqueta "parcial" en los no finales.
- Auto-scroll al último segmento.

## 4. Archivos modificados

### 4.1 `apps/processor/src/main.ts`

Registra el `DeepgramConsumer` en `sessionFactory`, junto al `DemoConsumer`,
solo si existe la variable de entorno:

```ts
if (DEEPGRAM_API_KEY) {
  consumers.push(
    new DeepgramConsumer(
      request.meetingId,
      DEEPGRAM_API_KEY,
      (result: ProcessingResult) => void results.post(result),
      log,
    ),
  );
}
```

Y avisa por log si la clave no está configurada (transcripción desactivada).

### 4.2 `apps/processor/package.json`

Nueva dependencia y tipos para el WebSocket de Deepgram:

```
"ws": "^8.21.0"           (dependencies)
"@types/ws": "^8.18.0"    (devDependencies)
```

### 4.3 `apps/web/src/pages/MeetingRoomPage.tsx`

- Nuevo tipo de panel: `'transcript'`.
- Estado nuevo: `transcript` (arreglo de `TranscriptSegment`).
- En el listener de `processing:result`, los resultados de transcripción se
  enrutan al store; los demás siguen al estado `lastResult` existente:

```ts
s.on(RT_EVENTS.serverProcessingResult, (result: ProcessingResult) => {
  if (result.kind === 'transcript-partial' || result.kind === 'transcript-final') {
    setTranscript((current) => applyTranscriptResult(current, result));
  } else {
    setLastResult(result);
  }
});
```

- Render del panel `{panel === 'transcript' && <TranscriptPanel ... />}`.
- Botón "Transcripción" en la barra inferior de controles.

### 4.4 `apps/web/src/styles.css`

Estilos del panel: `.transcript-list`, `.transcript-empty`, `.transcript-line`,
`.transcript-line.partial`, `.transcript-meta`, `.transcript-text`.

### 4.5 Configuración de entorno

Se agregó la variable `DEEPGRAM_API_KEY` en:

- `.env` (raíz) y `.env.example` (raíz)
- `apps/processor/.env.example`

Importante sobre la carga de `.env` en el processor (`main.ts`):

```ts
loadEnv({ path: resolve(__dirname, '../../../.env') });         // raíz
loadEnv({ path: resolve(__dirname, '../.env'), override: true }); // local gana
```

El `.env` local de `apps/processor/` **tiene prioridad** sobre el de la raíz.
Para que la clave aplique hay que dejarla en el archivo que se esté usando
(el local gana si existe).

## 5. Contrato de resultados usado (sin cambios)

Definido en `packages/contracts/src/media.ts`:

```ts
interface ProcessingResult {
  resultId: string;
  replacesResultId?: string;
  meetingId: string;
  participantId?: string;
  trackSid?: string;
  kind: 'demo' | 'transcript-partial' | 'transcript-final' | 'analysis';
  isFinal: boolean;
  createdAtMs: number;
  payload: Record<string, unknown>;
}
```

Para transcripción, `payload` es `{ text, startMs, endMs }`. El campo
`participantId` es el `Participant.id` interno, lo que permite mapear el nombre
en la UI.

## 6. Puesta en marcha

1. Instalar dependencias (raíz del repo):
   ```
   npm install
   ```
2. Crear el archivo de entorno y poner la clave real de Deepgram (se obtiene en
   https://console.deepgram.com → API Keys):
   ```
   copy .env.example .env
   ```
   y editar `DEEPGRAM_API_KEY=<tu_clave>`.
3. Levantar infraestructura (PostgreSQL + LiveKit):
   ```
   docker compose up -d
   ```
4. En terminales separadas:
   ```
   npm run dev:server      (puerto 3000)
   npm run dev:processor   (puerto 4100)
   npm run dev:web         (puerto 5173)
   ```
5. Abrir http://localhost:5173, crear/entrar a una reunión, activar el
   micrófono y pulsar el botón **Transcripción**.

## 7. Pruebas

```
npm test -w apps/processor
npm test -w apps/web
```

- Processor: 19/19 (incluye los 7 nuevos del consumidor de Deepgram).
- Web: incluye las pruebas del store de transcripción.

## 8. Limitaciones y notas

- **Sin persistencia**: los resultados de transcripción son prescindibles por
  diseño; no se guardan en la base de datos. La UI los mantiene en memoria y se
  pierden al recargar.
- **Un stream por participante**: el texto se asocia a quién habla; no hay
  diarización dentro de un mismo track.
- **Sin sincronización exacta** entre participantes (el `mediaTimeMs` es
  acumulado por pista, no RTP absoluto).
- **Latencia**: `endpointing=300` ms marca el corte de cada frase, por lo que el
  resultado final aparece poco después de terminar de hablar.
- La reproducción depende de una clave válida de Deepgram; si falta o es
  incorrecta, el consumidor no produce resultados (el resto de la app funciona).
