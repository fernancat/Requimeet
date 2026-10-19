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
5. Solo finales disparan `transcript.confirmed`. La IA agrupa 1.5 segundos de
   cambios y procesa bloques de hasta 20 segmentos con contexto acotado.
6. El worker consulta trabajos cada 2 segundos, con máximo tres intentos y
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
aprobación ni resuelve preguntas automáticamente. Los editores completos siguen en
«Revisión detallada» y en la revisión posterior.

El avatar carga Three.js de forma diferida y un GLB local CC0 de Quaternius (404 KB).
Usa la animación Idle, respeta movimiento reducido, evita renderizar fuera de vista
y libera los recursos al desmontarse. Si WebGL falla, el flujo textual sigue usable.
La licencia y procedencia están en `apps/web/public/models/brody/LICENSE.txt`.
