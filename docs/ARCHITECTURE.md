# RequiMeet — Arquitectura

## Componentes y responsabilidades

Monorepo npm: React/Vite (`apps/web`), monolito modular NestJS (`apps/server`),
PostgreSQL/Prisma, LiveKit como SFU y processor multimedia (`apps/processor`).
`packages/contracts` contiene contratos REST, eventos, contenido del documento
y el renderizador SVG del modelo conceptual.

El processor es un proceso técnico separado: consume PCM de LiveKit, conecta
Deepgram por pista y envía resultados autenticados al backend. No accede a la
base de datos ni decide permisos. No se persiste audio/video.

Módulos del servidor:

- `identity`: autenticación JWT del anfitrión y sesiones de invitado.
- `meetings`: ciclo de vida, admisión, moderación y autorización centralizada
  en `MeetingAccessService` para los recursos de levantamiento.
- `livekit`: tokens con permisos mínimos, sala SFU y webhooks firmados.
- `chat`: historial persistente y deduplicación de mensajes por `clientRef`.
- `realtime`: autenticación Socket.IO y retransmisión de eventos; sin reglas
  de generación ni decisiones de autorización de documentos.
- `processing`: inicio y cierre coordinado del processor; recepción interna
  de resultados protegida por secreto compartido.
- `transcripts`: segmentos parciales/finales, revisión, historial y recuperación.
- `requirements`: propuestas, edición, aprobación, reapertura y descarte.
- `ai`: cliente OpenRouter y cola PostgreSQL para análisis incremental.
- `questions`: preguntas por categoría, respuestas y evidencia.
- `artifacts`: modelos de entidades, documentos versionados y exportaciones.

## Persistencia y permisos

Las tablas base son `HostUser`, `GuestSession`, `Meeting`, `JoinRequest`,
`Participant` y `ChatMessage`. El levantamiento agrega:

- `TranscriptSegment`: resultado estable, revisión, participante, pista, tiempo
  de reunión y de pista, original, texto corregido e historial. `isFinal`
  distingue evidencia confirmada; `analyzedRevision` permite análisis incremental.
- `Requirement`: original, texto vigente, estado, fuentes múltiples, versión,
  descarte reversible e historial. Se conserva la relación de origen anterior.
- `Question`: categoría, motivo, prioridad, fuentes, estado, respuesta, evidencia,
  versión e historial.
- `AiJob`: instantánea de entrada, huella, salida, estado, intentos y error.
- `Artifact`: propuesta independiente, contenido estructurado, huella de fuentes,
  versión, revisión humana e historial. `Meeting` apunta al modelo/documento elegido.

El propietario de la reunión administra todos los recursos y conserva acceso
tras finalizar. Los invitados admitidos solo consultan mientras está activa.
Los nombres visibles no identifican ni autorizan usuarios. Los IDs de recursos
y fuentes se verifican contra la reunión correspondiente.

Requerimientos: `PENDING` → corrección → `CORRECTED` → aprobación explícita →
`APPROVED`. Un aprobado se bloquea en servidor y UI; `reopen` crea una revisión
pendiente conservando la anterior. El descarte es reversible. Las escrituras
utilizan versión esperada y responden 409 ante conflictos.

Preguntas: `PENDING`, `ASKED`, `RESOLVED`, `DISCARDED`. Resolver exige respuesta
escrita o segmentos finales de la misma reunión como evidencia.

## Flujo multimedia y análisis

1. El anfitrión inicia la reunión. El servidor emite un token LiveKit oculto y
   de solo suscripción para el processor.
2. `MediaSession` consume pistas con buffers acotados y aislamiento por consumidor.
3. Deepgram recibe PCM después de abrir el WebSocket. Cada intervención usa
   `resultId` estable y revisiones crecientes. Los finales reemplazan parciales.
4. El backend persiste antes de retransmitir. No degrada finales con eventos
   atrasados. El frontend recupera páginas REST y reconcilia eventos por revisión.
5. Solo finales disparan `transcript.confirmed`. La IA agrupa 0.8 segundos de
   cambios y procesa bloques de hasta 20 segmentos con contexto acotado.
6. El worker consulta trabajos cada 0.5 segundos, con máximo tres intentos y
   timeout de 45 segundos por llamada. Actualmente se despliega un solo worker
   dentro del servidor; no requiere Redis. Recupera trabajos tras reinicio.
7. Las respuestas se validan estructuralmente y se comprueban sus referencias.
   La IA propone, nunca aprueba ni sobrescribe ediciones humanas.
8. Al terminar se bloquean nuevos ingresos, se solicita el cierre del processor
   y se espera hasta 15 segundos antes de borrar la sala. Se admiten resultados
   tardíos durante 30 segundos desde `endedAt`.

El tiempo de pista y la hora de recepción son aproximaciones: no se promete
sincronización exacta entre participantes. Un corte prolongado puede descartar
audio al agotarse los buffers; los parciales incompletos no se vuelven evidencia.
La entrega HTTP interna tiene reintentos acotados, no es almacenamiento durable
local del processor ante una caída prolongada del backend.

## Generación y revisión

OpenRouter usa exclusivamente `deepseek/deepseek-v4-flash`; se verifica en el
catálogo al realizar la primera solicitud. Las claves solo viven en configuración
privada de servidor/processor. Las pruebas automatizadas simulan los proveedores.

Entidades y relaciones se generan bajo demanda desde requerimientos aprobados.
Se editan mediante formularios y se visualizan como SVG. La validación impide
nombres duplicados, relaciones colgantes y fuentes ajenas. No se genera SQL.

El documento contiene alcance, roles, aprobados, reglas de negocio, prioridades,
criterios de aceptación, contradicciones y pendientes. Incluye una copia del
modelo de entidades elegido. Las prioridades o criterios inferidos se presentan
como propuestas. El inventario de aprobados se deriva directamente del servidor.

Regenerar crea otra propuesta sin sustituir la elegida. La huella permite detectar
fuentes modificadas; un documento desactualizado no puede marcarse revisado.
PDF y DOCX exportan la misma versión persistida, con estado de borrador/revisión,
tablas, fuentes y diagramas. No se llama a la IA al exportar.

## Interfaces y frontend

Los recursos de levantamiento usan `/api/meetings/:code`:
`transcripts`, `requirements`, `questions`, `analysis`,
`artifacts/entities`, `artifacts/document`.
`workspace:changed` notifica cambios ya persistidos y REST recupera el estado.
`processing:result` continúa transportando resultados multimedia en vivo.

El dashboard consulta `GET /meetings`. La ruta `/meetings/:code/review` permite
continuar el trabajo sin conectarse a LiveKit. La sala separa escenario multimedia,
tira de participantes, panel de trabajo y controles. La presentación utiliza
`contain` y pantalla completa; bajo 900px el panel se superpone con cierre explícito.
Los editores visitados permanecen montados al cambiar de panel.

## Límites operativos

- Solo una instancia del worker de IA; escalar requiere leases distribuidos.
- La latencia de preguntas depende también del proveedor; el análisis es incremental,
  no una garantía de tiempo de respuesta fijo.
- Las generaciones de artefactos rechazan instantáneas superiores a 250000 caracteres
  en lugar de truncarlas silenciosamente; los esquemas acotan tamaño y cardinalidad.
- LiveKit OSS no revoca tokens ya emitidos al expulsar: TTL de cinco minutos y
  revalidación reducen la ventana. Rate limiting en memoria es protección básica.
- Una presentación activa a la vez se controla en el cliente; el audio del sistema
  depende de soporte del navegador. No se puede encender micrófono/cámara ajenos.

### Brody: acompañamiento durante la reunión

La sala abre `BrodyAssistant` como flujo principal. Consume preguntas, requerimientos
y estados de análisis ya persistidos; `workspace:changed` y la reconexión disparan
recuperación REST, con consulta periódica como respaldo. No agrega llamadas al
modelo por cada render ni procesa texto parcial. La pregunta actual permanece
estable ante sugerencias nuevas; se continúa con preguntas realizadas y luego por
prioridad. «Después» aplaza localmente sin descartar la pregunta en la base.

Las respuestas, descartes y aprobaciones usan los contratos existentes con versión
esperada y autorización del servidor. Los borradores permanecen al cambiar de panel;
un conflicto muestra el error y conserva la respuesta local. Brody no infiere una
aprobación de requerimientos. Resuelve preguntas con respuestas claras y verificadas. Los editores completos siguen en
«Revisión detallada» y en la revisión posterior.

El avatar carga Three.js de forma diferida y un GLB local CC0 de Quaternius (404 KB).
Usa la animación Idle, respeta movimiento reducido, evita renderizar fuera de vista
y libera los recursos al desmontarse. Si WebGL falla, el flujo textual sigue usable.
La licencia y procedencia están en `apps/web/public/models/brody/LICENSE.txt`.

### Respuestas orales propuestas por Brody

`Question.askedAt` marca el momento de la pregunta detectada al pasar a ASKED. El análisis
incremental también produce `answerSuggestions` opcionales para preguntas realizadas,
sin respuesta humana. Una propuesta dudosa puede aclararse con nuevos segmentos. Cada pregunta expone al proveedor los
IDs de segmentos finales nuevos y del contexto reciente con `createdAtMs >= askedAt` como evidencia
permitida. Puede responder el anfitrión o cualquier participante admitido.

La propuesta se persiste en `Question.answerSuggestion` con control de versión,
validación de pertenencia y revisión de las fuentes. Una edición humana o corrección
de la transcripción durante la inferencia evita guardar la propuesta obsoleta.
El proveedor clasifica claridad como clear, uncertain o contradictory y adjunta
citas literales. Solo clear con citas verificadas permite guardar respuesta/evidencia,
marcar RESOLVED y automaticResolution=true y avanzar sin botón. En los otros casos
la pregunta sigue ASKED y se muestra la duda para confirmación o aclaración oral.
El historial identifica a Brody y la ejecución. La interfaz muestra las respuestas
automáticas con acciones para corregir o seguir aclarando. Rechazar limpia la propuesta y reinicia
`askedAt`, sin volver a usar el mismo texto. El historial conserva la propuesta al
editar. No se agregan llamadas IA: la detección comparte el lote incremental.


### Apertura y detección de preguntas sin botones

Cada reunión nueva crea transaccionalmente una pregunta PENDING de apertura:
«Para empezar, ¿a qué se dedica la empresa?». Es una guía de entrevista, sin fuentes
inventadas ni requerimientos atribuidos a la empresa. El mismo análisis incremental
propone siguientes preguntas contextualizadas (máximo dos por lote): procesos,
personas, dificultades, objetivos y después reglas específicas.

`askedQuestions` devuelve pregunta existente, segmento y cita literal. Solo se
aceptan segmentos finales del anfitrión, posteriores a la creación de la pregunta,
con revisión vigente y cita verificable. Se registra el paso PENDING→ASKED y la
fuente en historial. La respuesta puede llegar en otro lote o en el mismo segmento;
en este último caso se comprueba que su cita aparezca después de la pregunta.
Detección y resolución comparten transacción y control de versión para no pisar
ediciones humanas. No se agregan llamadas al proveedor ni se procesa texto parcial.
La clasificación semántica sigue dependiendo del modelo; citar el tema no debería
interpretarse como formular una pregunta. Las acciones manuales quedan para dudas,
correcciones o cambios de rumbo, no para el camino habitual de la entrevista.


### Análisis breve durante la conversación

La política v9 conserva `deepseek/deepseek-v4-flash`. El turno activo, tanto
PENDING como ASKED, usa una interpretación semántica breve con
`reasoning.effort=none`, hasta 1800 tokens y timeout de 12 segundos por petición.
El análisis general sin turno activo conserva `low`/3000; documentos y entidades
no cambian. El razonamiento comparte el presupuesto de salida: en una comparación
real, `low` agotó 3000 tokens en 26,3 s sin devolver contenido y terminó en
`length`. La configuración rápida se validó con un prompt específico de conversación,
no quitando razonamiento al prompt general anterior.
Referencia: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.

Una pregunta reformulada se detecta por intención y cita literal. La coincidencia
local exacta es solo un atajo. Una respuesta directa a la sugerencia activa puede
resolver PENDING sin fingir que se leyó la pregunta: conserva `askedAt=null` y
registra `direct-answer`. Las dudas quedan como propuesta, con citas y fuentes
confirmadas posteriores a la creación de la pregunta. Se mantienen el control de
versión y la protección de cambios humanos. Detecciones inválidas no habilitan
esta ruta. Otras preguntas pendientes no se resuelven como efectos laterales.

La interpretación publica la respuesta antes del seguimiento. Si no queda una
pregunta abierta, otra petición breve genera una pregunta de continuación y
necesidades explícitas nuevas. Se conserva contexto, preguntas anteriores y
requerimientos; no se inventan necesidades a partir de la actividad comercial.
La interfaz sigue esperando 900 ms de pausa antes de cambiar la pregunta visible.
`timing.provider` conserva tiempo al primer contenido, duración, tokens de salida,
tokens de razonamiento y motivo de finalización del stream, sin registrar secretos
ni razonamiento interno. El error distingue límite de tokens de error de generación.

`live-analysis.prompt.ts` prioriza evaluar preguntas ASKED antes de abrir temas.
Ordena el contexto cronológicamente y pide interpretar fragmentos consecutivos
como una respuesta, sin exigir datos no solicitados por la pregunta. Limita nuevas
preguntas a una por lote y requerimientos a cinco. Se mantienen citas verificadas,
control de revisión y confirmación para incertidumbre real. El perfil de análisis
forma parte de la huella del trabajo (`policyVersion`). Un análisis explícito puede
revisitar finales ya analizados cuando queda una pregunta PENDING o ASKED sin respuesta;
la misma huella sigue evitando duplicados.


## Resultados progresivos de Brody

El análisis en vivo utiliza SSE en la misma llamada a DeepSeek V4 Flash. El prompt
ordena detección de preguntas, respuestas, próxima pregunta y requerimientos. Solo
se publican arrays JSON completos: cada unidad pasa el esquema, validación de
fuentes/citas/revisiones y transacción antes del evento Socket.IO. La interfaz puede
avanzar mientras continúa la extracción de requerimientos. Nunca muestra tokens
incompletos como decisiones.

Los identificadores se sustituyen por alias reversibles únicamente durante el
transporte; la transcripción, contexto, decisiones humanas y versiones permanecen
intactos. Los alias se expanden antes de validar referencias. Los documentos
mantienen su generación habitual sin streaming.

Las detecciones persistidas por el mismo trabajo pueden continuar en el siguiente
fragmento. El control de versión impide duplicar respuestas o sobrescribir cambios
humanos. Un corte conserva unidades ya guardadas y reintenta el trabajo; solamente
el resultado final válido marca los segmentos como analizados. No se añaden
llamadas paralelas ni se cambia el modelo.

## Pausas de audio y continuidad entre lotes

Deepgram confirma segmentos con `is_final`; el processor los publica inmediatamente
y no espera al marcador de fin de intervención `speech_final`. Cuando WebRTC
deja de entregar PCM (silencio/DTX/mute), el monitor revisa cada 250 ms si hay un
parcial pendiente y 600 ms sin paquetes. Solicita `Finalize` una sola vez por pausa;
solo la respuesta confirmada del proveedor puede alimentar la IA. KeepAlive sigue
limitado a una vez cada cinco segundos sin audio.

Una detección repetida de una pregunta ASKED es una operación sin cambios si la
fuente, participante anfitrión y cita son válidos. No descarta las respuestas del
lote ni modifica la versión. Al agotar reintentos, se vuelve a comprobar el texto
acumulado; el fingerprint evita reencolar indefinidamente el mismo input fallido.

Referencias:
https://developers.deepgram.com/docs/understand-endpointing-interim-results
https://developers.deepgram.com/docs/finalize

Las propuestas repetidas para preguntas RESOLVED/DISCARDED conocidas se ignoran
antes de persistir: no reabren respuestas ni bloquean las preguntas nuevas del
lote. IDs desconocidos y evidencia inválida en preguntas activas siguen rechazados.

## Latencia y respeto del turno de voz

El diagnóstico del turno lento mostró dos respuestas vacías del modelo y un
reintento antes de obtener seguimiento. El worker agrupa finales durante 400 ms,
revisa la cola cada 200 ms y encola inmediatamente el texto acumulado al terminar
un lote. Hasta tres reuniones pueden ejecutarse simultáneamente, manteniendo
exclusión por meetingId; una sala lenta ya no bloquea todas las demás. Este diseño
sigue asumiendo una sola instancia del worker PostgreSQL.

Las preguntas literales al comienzo de hasta tres segmentos confirmados
consecutivos del anfitrión se reconocen conservadoramente con su cita y fuente
elegible. Se exige toda la pregunta, tolerando puntuación y acentos del ASR; una
coincidencia parcial o voz de invitado no basta. Las paráfrasis siguen
dependiendo del modelo. Se conserva el contexto completo del lote y se prioriza
latencia en OpenRouter sin cambiar deepseek/deepseek-v4-flash:
https://openrouter.ai/docs/guides/routing/provider-selection

Si el análisis resuelve el turno pero no propone seguimiento y no quedan preguntas
abiertas, hace una pasada enfocada adicional con las mismas fuentes y decisiones
actuales. No utiliza preguntas prefabricadas ni modifica respuestas humanas.
Las propuestas para preguntas pendientes sin detección o con evidencia fuera de
su ventana se descartan individualmente; nunca se guardan como respuestas. Una
propuesta inválida así no obliga a reintentar otras respuestas válidas. Las fuentes
desconocidas de requerimientos/preguntas nuevas siguen rechazándose.

La persistencia no agrega seguimientos mientras exista una pregunta abierta.
En la sala, la lista visible de preguntas/respuestas automáticas se conserva
mientras LiveKit detecta algún hablante y durante 900 ms después. Una nueva voz
reinicia la pausa. Las consultas y el análisis continúan; al liberar se utiliza
la instantánea más reciente, no la primera que llegó. Esto protege el cambio
visible de turno; la persistencia de respuestas validadas continúa en segundo plano.

Cada resultado de análisis incluye timing: ageBeforeAttemptMs (edad del trabajo
antes de ese intento; puede incluir intentos previos), firstAnswerMs,
firstQuestionMs y totalMs desde el comienzo del intento. Los hitos de respuesta/
pregunta corresponden a arrays recibidos/validados, no a pintura del navegador;
para medir el recorrido completo se utiliza el harness de voz.

#### Reconciliación del processor

`ProcessingRecoveryService` contrasta el inventario de pistas del SFU con
`ProcessingSessionInfo.audioTrackSids`. Una etiqueta `connected` por sí sola no
prueba que la sesión siga recibiendo nuevas publicaciones. Tras dos muestras
inconsistentes, la recuperación reemite un token y reemplaza la sesión con el
mismo origen temporal. Las llamadas externas y el cierre tienen límites; las
transiciones por reunión se serializan para evitar procesadores duplicados.

El audio para reconocimiento se remuestrea en el SDK nativo a 16 kHz mono (PCM16): reduce de 768 a 256 kbit/s la subida por pista a Deepgram. El audio de la llamada conserva su configuración original.

#### Aislamiento del cierre de pistas

La cola compartida puede descartar audio/vídeo bajo presión, pero conserva eventos
como inicio, publicación y cierre. El descarte selecciona el elemento multimedia
más antiguo sin alterar el orden de los eventos; si solo quedan eventos, estos
se conservan aunque superen el límite de frames.

Cerrar el stream Deepgram de un participante no bloquea la cola de los demás.
El consumidor separa inmediatamente la pista retirada y conserva una promesa de
su drenado. El cierre de sesión espera también los drenados ya iniciados y sus
resultados finales, no solo las pistas que siguen publicadas.


Los finales de transcripción pueden incluir `previousPartialText` para auditar
una revisión ASR. Se conserva en el historial como `asr-revision` no confirmada,
incluso si el final llega antes que el parcial. Solo el texto final alimenta IA;
la interfaz permite consultar la hipótesis anterior sin promoverla a evidencia.
El detector de preguntas tolera introducciones y determinantes de empresa
acotados, conservando cita literal, autor y referencias elegibles.
