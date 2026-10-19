# Validación del levantamiento

Verificación realizada el 19 de octubre de 2026 sobre la implementación integrada.

## Resultados

- `npm run build`: contratos, processor, servidor y frontend compilados.
- `npm test`: 128 pruebas aprobadas: 20 del processor, 65 del servidor y 43 del frontend.
- PostgreSQL aislado: migraciones desde la base de Cristina hasta todos los cambios nuevos.
- Flujo de integración con IA simulada: parciales/finales, deduplicación, fuentes,
  preguntas, aprobación, entidades, documento, exportación y obsolescencia.
- Errores IA: referencias inventadas rechazadas, tres intentos máximos y reintento manual.
- Pruebas de autorización y revisión: invitados sin escritura, acceso posterior
  del propietario, bloqueo de aprobados, reapertura e historial, versión esperada.
- Dos clientes conectados al LiveKit local con una pista canvas de presentación:
  tamaños 360, 768, 1366, 1920px y viewport equivalente a zoom 200%; sin desbordamiento
  horizontal ni errores JavaScript. Pantalla compartida conservó `object-fit: contain`.
- Revisión móvil: sin desbordamiento horizontal. Los diagramas tienen desplazamiento propio.
- PDF y Word renderizados: acentos, tablas, pies y diagrama. Fixture extenso con
  48 atributos y criterios largos comprobó tablas multipágina y detalle de entidades.
- OpenRouter real: modelo exacto presente en catálogo y solicitud mínima HTTP 200.
- Deepgram real: WebSocket autenticado, un segundo de PCM sintético y cierre confirmado.
  No se enviaron reuniones reales ni se evaluó precisión de reconocimiento del habla.
- Credenciales solo en archivos `.env` privados ignorados por Git.

## Límites y observaciones

- La comprobación de pantalla compartida usa una pista sintética para ser reproducible;
  el selector nativo del sistema y su audio dependen del navegador y del escritorio.
- La calidad semántica del levantamiento requiere revisión humana con conversaciones
  representativas. Los tests verifican contratos, permisos y flujos, no garantizan
  que toda inferencia del modelo sea correcta.
- Vite conserva un aviso de tamaño del bundle, dominado por el cliente LiveKit.
- `npm audit --omit=dev` informa tres entradas altas heredadas de la cadena
  Prisma → @prisma/config → deepmerge-ts (agotamiento de pila en grafos recursivos).
  No se aplicó un override de versión mayor fuera de la actualización funcional.
- El worker IA actual está diseñado para una única instancia del servidor. Véanse
  límites de generación, tiempos y buffers en ARCHITECTURE.md.

Las bases `requimeet_test` y `requimeet_qa` son de verificación y no contienen datos
reales de reuniones. Los scripts reproducibles están documentados en INTEGRACION.md.

## Brody: asistente de reunión (19 de octubre de 2026)

- Frontend: 50 tests pasan; build TypeScript/Vite correcto. Los 7 tests nuevos cubren
  selección estable, prioridades, aplazamiento, borradores ante actualizaciones,
  conflictos de edición y consulta de invitados.
- Chromium con LiveKit Cloud y preguntas sintéticas en una reunión diagnóstica:
  pregunta realizada, respuesta persistida por REST, avance a la siguiente pregunta
  y conservación del borrador al cambiar al chat y volver.
- Pantalla compartida sintética con Brody a 360, 768, 1366 y 1920px: presentación
  visible, respuesta accesible mediante desplazamiento y sin overflow horizontal.
- Capturas de escritorio y móvil inspeccionadas: GLB local renderizado, globo de
  texto legible y controles accesibles. Sin errores JavaScript en el flujo probado.
- Se conserva el aviso de tamaño de chunks de Vite; Three.js carga diferido.
- Esta verificación no vuelve a medir latencia de proveedores ni reconocimiento
  de voz: reutiliza el procesamiento incremental ya verificado. Brody no habla
  por audio ni deduce respuestas automáticamente.

## Detección de respuestas orales

- Servidor: 69 tests aprobados; frontend: 52. Builds de servidor y frontend correctos.
- Casos nuevos: propuesta con evidencia sin resolución automática, protección de
  respuesta humana concurrente, rechazo de evidencia anterior a ASKED, rechazo de
  propuesta y nueva ventana de escucha, borrador local intacto y estado de micrófono.
- OpenRouter real con texto sintético ingresado como segmento final: propuesta
  persistida con fuentes y estado ASKED. Confirmación desde Chromium verificada
  en PostgreSQL como RESOLVED. Esta prueba valida el enlace transcripción→IA→UI,
  no una nueva prueba de reconocimiento de voz mediante micrófono físico.

## Avance automático de respuestas

- 53 tests frontend y 8 casos de integración de respuestas aprobados. Resto de los
  65 tests del servidor también pasan en la ejecución de la suite; se corrigió
  la aserción anterior de propuesta para incluir el nuevo motivo de aclaración.
- Clasificación clara con cita literal resuelve y registra historial; uncertain,
  contradictory, clasificación omitida o citas no verificables mantienen ASKED.
- Reapertura de respuesta automática, protección de edición concurrente y
  conservación de borrador local durante el avance automático comprobadas.
- Builds de servidor y frontend correctos. La detección se ejecuta dentro del lote
  existente, sin nuevas llamadas de IA por cada actualización de interfaz.
- OpenRouter real con texto sintético: resolución automática persistida en
  PostgreSQL. Chromium mostró la respuesta guardada sin confirmación y permitió
  reabrirla con «Seguir aclarando», persistiendo ASKED. No se utilizó micrófono físico.

## Entrevista sin marcación manual

- 76 tests servidor y 54 frontend pasan. Builds de servidor y frontend correctos.
- Casos nuevos: detección de pregunta del anfitrión sin respuesta, pregunta y
  respuesta en el mismo lote con resolución automática, rechazo de atribución
  al anfitrión para voz de invitado y ausencia del botón «Ya la pregunté».
- Las reuniones nuevas reciben la pregunta de apertura al crearse; la prueba real
  ingresa texto sintético como pregunta/respuesta de un solo anfitrión, sin llamar
  al endpoint de cambio de estado de pregunta.
- OpenRouter real completó detección y resolución sin botones usando texto sintético.
  Chromium verificó que apareciera la siguiente pregunta, que la respuesta inicial
  quedara RESOLVED y que no existiera «Ya la pregunté». No sustituye una prueba de
  reconocimiento con micrófono físico.

## Latencia y reconocimiento de respuestas fragmentadas

- Se inspeccionaron ejecuciones persistidas: hubo lotes de 15–51 segundos y un lote
  que generó preguntas nuevas pero omitió evaluar una respuesta ASKED presente.
- Reejecución de ese mismo input sin modificar datos de la reunión: el trabajo
  anterior registró 25,830 ms totales; la nueva llamada con catálogo/validación tomó
  11,791 ms, devolvió una respuesta clear, seis fuentes con citas verificadas y una
  pregunta nueva. No es un benchmark controlado ni garantía de latencia; la segunda
  medición no incluye espera de la cola ni captura de audio.
- Pruebas del proveedor verifican modelo exacto, razonamiento desactivado solo en
  vivo y presupuesto de salida; los perfiles de documentos no cambian.
- Se añadió cobertura de revisión explícita de preguntas abiertas sobre segmentos
  ya analizados. El frontend deja de inferir insuficiencia de información solamente
  porque terminó un lote sin respuesta propuesta.


## Resultados progresivos y contexto íntegro

- Reejecución real y de solo lectura del mismo lote persistido de seis segmentos:
  respuesta completa a los 4,946 ms; siguiente pregunta a los 6,206 ms; resultado
  total a los 8,687 ms. Incluye consulta de catálogo, excluye captura de audio,
  cola y renderizado en navegador. La medición anterior fue 11,791 ms hasta recibir
  todo el resultado. Son muestras individuales, no una garantía ni percentiles.
- Se obtuvieron dos respuestas clasificadas clear, con tres y dos fuentes; todas
  las citas se verificaron contra los segmentos originales. El input pasó de
  3,695 a 2,677 caracteres únicamente mediante alias de IDs, sin resumir ni
  eliminar contexto. Se mantuvo deepseek/deepseek-v4-flash.
- Cobertura: SSE fragmentado byte a byte y Unicode, comentarios del proveedor,
  arrays completos, escape de cadenas, error/truncamiento/cierre inesperado,
  alias reversibles, persistencia anticipada, pregunta/respuesta en distintos
  fragmentos y reintento tras corte sin duplicación de historial.
- Esta comprobación no sustituye una medición de extremo a extremo con micrófono.
- Suite completa del servidor: 18 suites y 85 tests aprobados; build correcto.
