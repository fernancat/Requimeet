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
