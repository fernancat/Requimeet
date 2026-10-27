# RequiMeet — Integración y verificación

## Base y ramas

La base integrada es `53f2c49` (Cristina), `feat/alba-requerimientos`, que contiene
la transcripción de `feat/19-transcripcion-deepgram`. Se conserva su historial.
Las ramas 20–27 apilan transcripción, requerimientos, IA, preguntas, entidades,
documento, exportación y sala responsive. La rama 28 reúne correcciones encontradas
en la validación integral. Los commits nuevos usan `feat:` sin coautoría adicional.

## Preparación

```sh
npm ci
npm run prisma:generate -w apps/server
npm run prisma:deploy -w apps/server
npm run build
```

Prisma lee `apps/server/.env`. Utilizar una base PostgreSQL disponible y aplicar
las migraciones antes de iniciar. Las migraciones nuevas son aditivas y conservan
transcripciones/requerimientos anteriores. npm es el único gestor; no hay lockfile pnpm.

Configurar `OPENROUTER_API_KEY` solo en `apps/server/.env` y `DEEPGRAM_API_KEY`
solo en `apps/processor/.env`. Los ejemplos contienen nombres, nunca credenciales.
El processor también carga `.env` raíz y después su configuración local.

```sh
npm run dev:server
npm run dev:processor
npm run dev:web
```

Mantener consistentes `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y
`VITE_LIVEKIT_URL`: no mezclar credenciales locales con una URL LiveKit Cloud.
El frontend usa proxy de Vite si `VITE_SERVER_URL` está vacío. Para PDF el paquete
servidor debe incluir `assets/fonts` además de `dist` y dependencias.

## Contratos de extensión

- `MediaConsumer`: recibe frames y eventos. El procesamiento continúa si falla
  un consumidor. Audio/video no se almacena ni se imprime en logs.
- `ProcessingResult`: `resultId`, `revision`, `meetingId`, `participantId`,
  `trackSid`, `kind`, `isFinal`, `createdAtMs`, `payload`. Los tiempos se expresan
  en milisegundos y se conserva tiempo de pista separado.
- `TranscriptsService`: persiste y corrige segmentos. `transcript.confirmed`
  agenda análisis; parciales nunca ingresan al LLM.
- `AiService`: cola persistente, deduplicación por huella y handlers por tipo
  de generación. `OpenRouterService` encapsula modelo, timeout y configuración.
- `Artifact`: contenido validado, selección explícita y huella de fuentes.
  Regeneraciones no borran propuestas ni historial.
- `workspace:changed`: `{ code, resource }`; la UI vuelve a consultar recursos.
  Los eventos no sustituyen la autorización REST ni la recuperación de historial.

## API del levantamiento

| Recurso | Operaciones |
|---|---|
| `/meetings` | GET reuniones del propietario |
| `/meetings/:code/transcripts` | GET páginas de 100, `cursor` opcional |
| `/meetings/:code/transcripts/:id` | PATCH texto final y versión esperada |
| `/meetings/:code/requirements` | GET y POST manual con fuentes opcionales |
| `/meetings/:code/requirements/:id` | PATCH texto/estado o acción reopen/discard/restore, con versión |
| `/meetings/:code/questions` | GET preguntas |
| `/meetings/:code/questions/:id` | PATCH pregunta, estado, respuesta, evidencia y versión |
| `/meetings/:code/analysis` | GET estado; POST analizar/reintentar |
| `/meetings/:code/artifacts/entities\|document` | GET propuestas; POST generar |
| `/meetings/:code/artifacts/:kind/:id` | PATCH contenido o acción select/review con versión |
| `/meetings/:code/artifacts/document/:id/export/pdf\|docx` | GET exportar; `version` obligatoria |

Conflictos de edición devuelven 409. Fuentes inválidas devuelven 400. Consultas
ajenas o escrituras de invitados se rechazan aunque la UI oculte los controles.

## Pruebas

Los tests del servidor usan exclusivamente
`postgresql://requimeet:requimeet@localhost:55440/requimeet_test` y limpian sus tablas.
Nunca apuntar esta URL a datos de trabajo.

```sh
DATABASE_URL=postgresql://requimeet:requimeet@localhost:55440/requimeet_test npm run prisma:deploy -w apps/server
npm test
npm run test:exports
```

`test:exports` genera PDF y Word de prueba en `/tmp/requimeet-export-qa`.
La verificación visual debe incluir acentos, encabezados, pies, tablas y diagramas;
la extracción de texto no reemplaza inspeccionar las páginas renderizadas.

`npm run test:browser` necesita servidor :3000, frontend :5173 y LiveKit local
:7880, además de la base aislada `requimeet_qa` en :55440 con migraciones aplicadas.
Ejecutar el servidor con esa DATABASE_URL y OPENROUTER_API_KEY vacío; el frontend
con VITE_LIVEKIT_URL=ws://localhost:7880. Usa fixtures de texto y una pista de video
canvas para probar pantalla compartida con dos clientes reales LiveKit, sin gasto IA.

Instalar Chromium con `npx playwright install chromium` o indicar una ruta local
mediante `PLAYWRIGHT_EXECUTABLE_PATH`. Las capturas y el informe quedan en
`/tmp/requimeet-browser-qa`. La prueba comprueba 360, 768, 1366 y 1920px y un viewport
equivalente a zoom de 200%. Crea usuarios/reuniones de prueba en esa base aislada.

La integración automatizada cubre finalización, duplicados, revisiones atrasadas,
permisos, reapertura, evidencia obligatoria, validación IA, generación, conflictos,
fuentes desactualizadas y formatos exportados. Los proveedores reales se verifican
por separado con una llamada mínima y audio sintético, sin contenido de reuniones.

### Probar Brody en vivo

Al entrar a una reunión, «Brody · En vivo» se abre automáticamente. Hablar con el
micrófono activo produce segmentos finales y alimenta el análisis incremental
existente. Al llegar preguntas, el globo propone una por vez. La detección de la pregunta hablada
registra ASKED; «Guardar respuesta y continuar» registra RESOLVED con la respuesta;
«Después» conserva la pregunta pendiente para retomarla durante esa sesión.
Los requerimientos aparecen en el mismo flujo y se aprueban explícitamente.

La animación es visual, sin síntesis de voz ni captura adicional de micrófono.
Los invitados consultan sin controles de escritura. En móvil, el escenario y el
asistente comparten el espacio vertical; el asistente tiene desplazamiento propio
y puede minimizarse. La revisión completa se conserva en el selector secundario.

No requiere migraciones ni variables nuevas. El modelo Dino de Quaternius es CC0:
https://poly.pizza/m/wuerCFCWNR. Se sirve localmente y no llama a servicios de assets
durante una reunión. El chunk 3D se carga por separado del frontend principal.

### Responder hablando a Brody

Aplicar `prisma:deploy` y `prisma:generate` para la migración
`20261019050000_question_answer_suggestions` (ya aplicada en el entorno local).
Recargar el frontend. Hacer la pregunta sugerida en voz alta, hablar con el
micrófono activo y hacer una pausa. Brody detecta la pregunta sin marcar botones. No se necesita otro participante. Cuando llega
la transcripción final, Brody guarda y avanza automáticamente si la respuesta es
explícita, completa y sustentada por citas verificadas. Si hay dudas, muestra
«Necesito aclarar esta respuesta»: se puede aclarar hablando o confirmar/editando
la propuesta. Las respuestas automáticas quedan visibles con «Corregir» y «Seguir
aclarando». «No era esa respuesta» reinicia la escucha.

Mientras espera, Brody muestra el último texto recibido, el micrófono apagado,
el análisis en curso o que no encontró una respuesta clara. Si no aparece texto,
revisar micrófono/permisos y conexión de transcripción; si hay texto sin propuesta,
se puede aclarar hablando o guardar una respuesta manual. La latencia depende de
la finalización del audio y del proveedor, no del número de participantes.


Avance automático: migración `20261019060000_question_auto_resolution` aplicada en
el entorno local. Una respuesta resuelta automáticamente no aprueba requerimientos.
La clasificación de claridad depende del modelo; se conservan evidencia, historial
y corrección manual. Respuestas parciales, tentativas o contradictorias requieren
aclaración. El anfitrión realiza la pregunta hablando; Brody detecta cuándo se formula.


Para probar la apertura guiada, crear una reunión nueva: Brody muestra de inmediato
«Para empezar, ¿a qué se dedica la empresa?». Hacer esa pregunta, también con otras
palabras, y responder o escuchar al invitado. El análisis detecta la pregunta y
continúa con la respuesta sin «Ya la pregunté». La siguiente pregunta se adapta a
lo conversado. Las reuniones existentes conservan sus preguntas y respuestas.
No requiere migración adicional. La detección ocurre al confirmar la transcripción
y completar el lote de IA; no implica reconocimiento instantáneo por palabra.


El modo rápido de Brody ya está activo, sin cambio de modelo ni variables nuevas.
Recargar el frontend. Para una pregunta que quedó sin respuesta antes de este
ajuste, «Analizar ahora» permite revisitar el texto confirmado; también se sigue
analizando al hablar. El tiempo total depende de la pausa de voz, cola y proveedor:
no se garantiza una latencia fija. Los documentos mantienen el perfil anterior.


Brody publica ahora la respuesta y la siguiente pregunta antes de completar la
extracción de requerimientos. No necesita migraciones ni configuración adicional.
El backend actualiza la sala con eventos de cambios persistidos; el estado de
análisis puede seguir activo mientras concluye el resto del lote. Ante un corte,
las respuestas ya guardadas se conservan y el trabajo se reintenta sin duplicarlas.
El protocolo del proveedor está documentado en
https://openrouter.ai/docs/api-reference/streaming.

Prueba integral de voz: `node scripts/verify-brody-voice.cjs <carpeta-audios> <carpeta-resultados>`.
Requiere servicios locales activos y proveedores reales configurados. Usa
`round1.wav` con la apertura y una respuesta de empresa; al imprimir la siguiente
pregunta permite hasta 150 segundos para colocar `round2.wav` con esa pregunta
(parafraseada si se desea) y su respuesta. No pulsa botones de avance. Chromium
puede seleccionarse mediante `PLAYWRIGHT_EXECUTABLE_PATH`.
El audio entra como MediaStream del micrófono en el navegador y cruza LiveKit,
processor, Deepgram, persistencia, OpenRouter y Socket.IO hasta el DOM. La prueba
crea una cuenta/reunión aislada, espera que los finales queden analizados, guarda
capturas e informe sin tokens y termina la reunión. Los archivos contienen solo
los datos de la conversación de prueba. No mide micrófono físico, ruido ni eco.

Brody conserva la pregunta visible durante la voz y pausas menores de 900 ms.
Si ya tiene el seguimiento listo lo muestra después de la pausa; si el proveedor
sigue trabajando mantiene el estado de análisis. Recargar la sala para cargar
este comportamiento. No requiere migraciones ni nuevas credenciales.
El harness verifica que la siguiente pregunta no aparezca durante el audio ni con
data-speaking/data-turn-held activos. Para el segundo turno preparar un WAV que
formule la pregunta realmente mostrada y la responda; una pregunta pregrabada
distinta no prueba correctamente el reconocimiento de ese seguimiento.

### Detecciones parciales de Brody

Una detección de pregunta con referencia conocida pero sin cita literal válida,
fuera del intervalo elegible o atribuida a un invitado se descarta sin fallar
la extracción del lote. No marca la pregunta como realizada ni habilita una
respuesta automática dependiente. Las referencias desconocidas siguen rechazándose.
La regresión cubre extracción válida junto con detecciones inválidas por autor y cita.

### Recuperación de pistas y pruebas aisladas

El backend compara cada 10 s las pistas de audio activas del SFU con los SID
suscritos por el processor. Dos comprobaciones consecutivas con pistas ausentes
solicitan una nueva sesión, conservando el origen temporal de la reunión. Esto
cubre sesiones que todavía declaran `connected` pero mantienen participantes
antiguos, además del reinicio del proceso. Las sesiones por reunión serializan
arranque/cierre; las esperas de conexión, desconexión y drenado tienen límites.
Deepgram limita la apertura del WebSocket a 8 s.

En pruebas, Nest no carga archivos `.env` privados y el reconciliador no arranca.
El setup de Jest fija además endpoints y credenciales antes de importar Prisma
(que también puede cargar `.env`); las pruebas realtime simulan el servicio SFU.
Así los fixtures con credenciales ficticias no llaman al processor de una reunión
real. La interfaz usa la URL de LiveKit del token emitido por el backend, refleja
el estado real del micrófono y muestra errores al activarlo dentro de la sala.

El processor recibe PCM remuestreado por LiveKit a 16 kHz mono: 256 kbit/s
por pista, frente a 768 kbit/s a 48 kHz. Esto reduce el tráfico de reconocimiento
sin cambiar el audio que escuchan los participantes. Varias pistas siguen
requiriendo subida suficiente; ngrok transporta HTTP/Socket.IO, no este audio.

Prueba real reproducible (audio sintético propio, PCM16 mono 48 kHz):

```bash
node scripts/verify-multi-speaker.cjs https://tu-dominio /ruta/frase.pcm
QA_RECOVERY=1 node scripts/verify-multi-speaker.cjs http://localhost:5173 /ruta/frase.pcm
```

Crea una reunión aislada con anfitrión y dos invitados, verifica finales por
participante, eventos Socket.IO, reconexión y una ejecución IA completada.
La opción de recuperación lee el secreto interno local sin imprimirlo y detiene
únicamente la sesión de esa reunión para comprobar su recuperación automática.
No prueba un micrófono físico ni el render de Brody. Un fallo de red hace fallar
la prueba; no se presenta como resultado satisfactorio.

### Diagnóstico adicional de audio (2026-10-24)

Se reprodujeron sin red dos fallos: un `onTrackUnpublished` que esperaba hasta
5 s bloqueaba todos los participantes de la cola compartida; la política
`drop-oldest` eliminaba también eventos de ciclo de vida al saturarse. Las
regresiones comprueban aislamiento entre participantes, conservación de eventos
y entrega de finales tardíos durante el cierre.

Comprobaciones externas acotadas: la clave configurada de Deepgram abrió tres
WebSockets simultáneos (sin 401/429); OpenRouter devolvió JSON válido con
`deepseek/deepseek-v4-flash`. Los tokens/secretos internos y LiveKit coincidieron
entre servidor y processor. Estas pruebas verifican las credenciales actuales,
no garantizan saldo ni disponibilidad futuros.

Se comparó recepción RTC de tres emisores sintéticos, entradas y salidas con
transporte automático y con TURN forzado: ambos pasaron en esa ronda. No se
fuerza TURN en producción por esa sola comparación. El SDK instalado 0.13.35
ya incluye la corrección anterior de streams desuscritos; no se atribuye todo
el incidente a una versión antigua sin comprobarlo.

Referencias: [fiabilidad de conexión LiveKit](https://docs.livekit.io/intro/basics/connect/),
[límites por proyecto Deepgram](https://developers.deepgram.com/reference/api-rate-limits),
[versiones del SDK Node](https://github.com/livekit/node-sdks/releases).

Tras aplicar las correcciones pasó el harness real por la URL pública de ngrok:
tres voces con finales persistidos, reconexión de un invitado con nueva pista,
recuperación automática después de detener solo su sesión del processor,
eventos Socket.IO de los tres participantes y análisis IA completado. Se usó
audio sintético y una reunión aislada; no equivale a validar micrófonos físicos
ni la interfaz visual de todos los compañeros. Build y 182 tests pasaron.


### Preguntas naturales y revisiones ASR

Brody reconoce «¿A qué se dedica tu empresa?» como la pregunta inicial
«Para empezar, ¿a qué se dedica la empresa?», sin exigir leer la introducción.
No se usan coincidencias parciales de tema para marcar una pregunta realizada.
`Analizar ahora` permite revisar también preguntas pendientes no detectadas.
La política v9 utiliza interpretación semántica del turno activo con DeepSeek V4
Flash sin razonamiento extendido. Reconoce paráfrasis y respuestas directas,
conservando validaciones de citas, versiones y fuentes. El seguimiento se genera
después de guardar la respuesta; no se exige leer la sugerencia literalmente.
Publica respuestas completas del stream sin esperar el array askedQuestions.

Cuando Deepgram cambia un provisional al emitir el final, el anterior queda
conservado en historial y se puede desplegar en Transcripción. Es texto **no
confirmado**: no se concatena al final ni se usa para aprobar respuestas.
La frase sintética «Mi empresa se dedica a asuntos jurídicos» salió completa
con Nova-2 y Nova-3; esa prueba no reproduce por sí sola la pérdida reportada
en el micrófono real ni justifica cambiar de modelo automáticamente.

### Verificación de turnos semánticos (2026-10-24)

- Comparación real con el mismo contexto: perfil low/3000 terminó en `length`
  tras 26,3 s y sin JSON; none/1800 completó en 3,7 s. No se cambió de modelo.
- Prueba integrada con PostgreSQL de pruebas y OpenRouter real, sin tocar reuniones
  del usuario: paráfrasis detectada en 0,91 s; respuesta a pregunta reformulada y
  siguiente pregunta persistidas en 1,85 s; respuesta directa fragmentada sin leer
  pregunta y seguimiento en 2,67 s. La actividad comercial no creó un requerimiento;
  la petición explícita de registrar datos sí produjo uno.
- Son tiempos desde texto confirmado hasta persistencia, no desde el micrófono ni
  hasta el render del navegador. Se conservan la captura/endpointing de Deepgram,
  agrupación de 400 ms, selección de cola y pausa visual de 900 ms (pueden solaparse).
- Hubo un timeout aislado del proveedor durante las pruebas previas; estas muestras
  no constituyen una garantía de latencia ni un percentil. El perfil conversacional
  limita cada petición a 12 s y mantiene los reintentos acotados existentes.
- Pruebas automatizadas cubren paráfrasis, respuestas directas host/invitado,
  incertidumbre, citas inventadas, historial sin pregunta ficticia, conflictos de
  versión y telemetría del stream. No se sustituyen decisiones humanas.

Documentación consultada:
https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
https://openrouter.ai/docs/guides/routing/provider-selection
https://developers.deepgram.com/docs/understand-endpointing-interim-results

### Resiliencia de IA y estados de recuperación (2026-10-24)

Aplicar la migración aditiva `20261025020000_ai_job_retry_schedule` antes de
reiniciar el servidor. Añade `AiJob.nextAttemptAt` y su índice; conserva trabajos,
transcripciones, requisitos y artefactos existentes.

Cobertura de regresión independiente de la transcripción concreta:

- JSON normal, BOM, Unicode, bloque Markdown completo y bloques divididos en SSE.
- Rechazo de prosa, arrays raíz, bloques múltiples/truncados, JSON inválido,
  estructuras incorrectas, salida excesiva y contenido adicional.
- HTTP 401/402 sin reintento ciego; 429 con Retry-After; timeouts, rechazo,
  errores SSE después de HTTP 200 y límite de tres intentos con backoff.
- Preservación de respuestas publicadas antes de un corte; recuperación del
  seguimiento desde checkpoint incluso tras recrear el worker; claims abandonados.
- Estado de análisis separado de documentos; ráfagas de eventos más rápidas que
  REST, cambio de sala, cancelación y recuperación de errores de consulta.

Validación: 135 tests del servidor, 63 de web y 27 del processor; build del
monorepo. Llamadas reales de contrato completo y streaming con V4 Flash terminaron
correctamente en 1,28 y 1,16 s. Una prueba integrada en otra temática (taller de
bicicletas) recorrió pregunta, respuesta y seguimiento sin errores de formato.
Con routing por throughput, dos turnos integrados midieron 5,44 y 6,96 s desde
texto confirmado hasta seguimiento; no son latencias de micrófono a pantalla ni
percentiles garantizados. El proveedor puede variar y se registra su identificador,
la generación, tokens y tiempos por petición para diagnosticarlo.

Fuentes oficiales:
https://openrouter.ai/docs/guides/features/structured-outputs
https://openrouter.ai/docs/api_reference/errors-and-debugging
https://openrouter.ai/docs/api_reference/streaming
https://openrouter.ai/docs/guides/routing/provider-selection

## Voz de Brody — Eleven v4 Turbo

1. Aplicar migraciones (`npm run prisma:deploy -w apps/server`) y regenerar Prisma.
2. Configurar `ELEVENLABS_API_KEY` sólo en `apps/server/.env`, con permisos de Text to
   Speech. `ELEVENLABS_VOICE_ID` es opcional; por defecto se usa la voz documentada
   `21m00Tcm4TlvDq8ikWAM`. El modelo está fijado en `eleven_v4_turbo`, sin fallback.
3. En la sala, el anfitrión pulsa «Activar voz de Brody». «Compartir voz con todos»
   habilita acceso para participantes admitidos. Cada navegador puede necesitar
   «Escuchar a Brody» una vez; «Silenciar en mi equipo» sólo afecta a ese dispositivo.
4. Mencionar «Brody» en voz alta con la transcripción activa. Responde usando el
   contexto confirmado. La voz está apagada inicialmente y sólo lee preguntas nuevas
   o responde a menciones; no narra todos los eventos de la interfaz.

REST: GET/PATCH `/meetings/:code/voice`, POST `/meetings/:code/voice/question`
(con `questionId`/`version`), GET `/meetings/:code/voice/:id/audio`. Ajustes requieren
`enabled`, `shared` y `version`. Audio MP3 privado con `Cache-Control: no-store`.
No se necesita configuración de ElevenLabs en frontend o processor.

Validación sin créditos: `npm test`; con Vite activo y un MP3 ya disponible,
`node scripts/verify-brody-tts-browser.cjs /ruta/fixture.mp3` prueba dos clientes,
turnos, voz compartida y vista de 360 px simulando REST. No llama a proveedores.
La prueba de integración real `verify-brody-tts.cjs` exige deliberadamente la bandera
`--real-providers` y un clip sintético con una mención. No ejecutar sin autorización
para consumir créditos. No utiliza un micrófono físico.

Se verificó una síntesis real breve de v4 Turbo (aprox. 1,3 s para recibir audio completo).
Esto no mide la latencia de responder a una mención ni representa un SLA. Tras pedir
el usuario conservar créditos, las comprobaciones restantes se realizan con proveedores
simulados y el audio ya generado. No se afirma un consumo exacto ni saldo de la cuenta.

### Corrección de continuidad de voz y panel (feature 45)

Una pregunta recién propuesta puede pasar de PENDING a ASKED antes de terminar su
síntesis o reproducción. Ambos estados permiten leer una pregunta aún no escuchada;
los cambios sólo de estado/revisión no cortan el audio ni generan otro cobro del mismo
texto. RESOLVED/DISCARDED siguen invalidando la lectura.

Nova-2 recibe `keywords=Brody:2` para reconocer el nombre del asistente
(https://developers.deepgram.com/docs/keywords). Esto orienta el ASR, no reemplaza
palabras de la transcripción ni convierte cualquier «brother» en una invocación.
Las menciones anteriores a activar la voz siguen sin reproducirse retroactivamente.
La interfaz lo explica mientras está desactivada.

El panel completo posee un único desplazamiento principal y globos acotados, evitando
que encabezado/voz/avatar reduzcan la lista de requisitos a una franja sin contenido.
`node scripts/verify-brody-panel.cjs` verifica «Ver aquí» con contenido largo en
360, 768, 1366 y 1920 px, sin proveedores. Las regresiones de voz usan audio previamente
generado; no se realizó una nueva comprobación pagada del reconocimiento de «Brody».
