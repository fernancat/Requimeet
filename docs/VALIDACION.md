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

## Flujo real de audio a siguiente pregunta (19 octubre 2026)

Se usó Chromium con un MediaStream de Web Audio como micrófono, voz sintética en
español, LiveKit Cloud, processor, Deepgram y OpenRouter reales. No se inyectaron
transcripciones ni se pulsaron botones para marcar preguntas/respuestas/analizar.
Un MutationObserver registró cuándo cambió la pregunta en el DOM. La prueba es de
un solo anfitrión que formula la pregunta y responde; no mide micrófono físico,
ruido, eco, interrupciones entre participantes ni una distribución estadística.

La primera ejecución quedó bloqueada 90 segundos sin trabajos IA: había texto
parcial sin cierre. Se corrigió publicación de is_final y Finalize durante ausencia
de PCM. Otras repeticiones revelaron rechazo del lote por detecciones repetidas y
propuestas para preguntas inactivas; se añadieron tolerancia idempotente y pruebas.
Una repetición intermedia resolvió ambas preguntas pero no mostró la siguiente;
estos intentos fallidos no se incluyen como muestras exitosas.

Última ejecución del harness, con las correcciones y cierre completo:

| Turno | Duración del audio | Fin del audio → siguiente pregunta visible | Inicio del audio → siguiente pregunta |
|---|---:|---:|---:|
| Empresa y recepción de pedidos | 12,936 s | 8,822 s | 21,762 s |
| Flujo de vendedor/bodega y falta de existencias | 14,808 s | 0,360 s | 15,175 s |

El análisis comienza sobre segmentos confirmados mientras continúa la voz, de ahí
la espera breve tras el segundo audio. En una ejecución anterior los intervalos
tras el audio fueron 3,937 y 0,654 segundos: la variación es importante y no se
garantiza un tiempo fijo. La medida usa el final del archivo reproducido, que puede
incluir una pequeña cola de silencio, y el cambio de DOM, no un fotograma de pantalla.

Se verificaron dos resoluciones automáticas, siete segmentos confirmados con
analyzedRevision igual a revision y siete trabajos completos sin errores. El hilo
fue empresa → gestión de pedidos → coordinación entre vendedor y bodega. La última
frase sobre falta de existencias quedó transcrita y analizada; no toda afirmación
se convierte en requerimiento ni en la siguiente pregunta. La respuesta de proceso
guardada resume revisión/factura; el despacho posterior queda en transcripción y
requerimientos, sin reescribir retroactivamente esa respuesta.

Validación automatizada: 88 tests servidor y 21 processor aprobados; builds de
ambos correctos. Nuevos casos: is_final independiente de speech_final, solicitud
Finalize sin promover parciales, detección repetida, protección de respuesta humana
cerrada y continuidad de texto acumulado tras agotar reintentos.
Harness reproducible: scripts/verify-brody-voice.cjs (requiere audio WAV y servicios
reales; puede generar consumo de proveedores).

## Variación de latencia y pausa antes de avanzar

Diagnóstico del turno previo de 8,822 s: dos ejecuciones devolvieron arrays vacíos,
incluyendo omisión de la pregunta literal, y una tercera necesitó reintento.
En las primeras pruebas de esta iteración también se observó un hito de respuesta
de 9,349 ms con solo 22 ms de edad de cola: el proveedor/transporte sigue teniendo
variación real. Priorizar latencia no equivale a una garantía de respuesta.

Se corrigieron espera adicional entre lotes, exclusión global entre salas,
detección literal (incluyendo pregunta dividida y puntuación de ASR), falta de
seguimiento tras respuesta resuelta y rechazo global por una propuesta individual
fuera de ventana. La repetición intermedia que dividió una pregunta y la terminó
con punto quedó bloqueada; se añadió el caso automatizado antes de repetir.
Las coincidencias literales requieren la pregunta completa, no un prefijo.

Última prueba integral con el detector corregido, sin botones de avance:

| Turno | Audio | Fin de audio → siguiente pregunta | Inicio de audio → siguiente pregunta |
|---|---:|---:|---:|
| Empresa y recepción de pedidos | 12,936 s | 1,179 s | 14,116 s |
| Venta, bodega y distribución | 20,400 s | 1,397 s | 21,801 s |

Una ejecución completa anterior a la corrección de puntuación registró 0,996 y
1,684 s. Son muestras de desarrollo, no percentiles ni un SLA; no se excluyen los
fallos intermedios descritos arriba para afirmar fiabilidad estadística. Los
segundos audios se adaptaron a la pregunta efectivamente generada; su duración
difiere de los audios antiguos, por lo que no representan un benchmark controlado.

En la última ejecución: 7 trabajos completos, 8 segmentos confirmados y analizados,
2 respuestas resueltas y 6 requerimientos. La respuesta de proceso conservó
vendedor, bodega y distribución. Se verificó por DOM que ninguna siguiente pregunta
apareciera antes de finalizar el audio ni con voz/retención activos. La captura de
micrófono fue sintética: LiveKit y ambos proveedores fueron reales. No se prueba
ruido/eco de un micrófono físico ni pausas humanas de duración arbitraria.

Pruebas: suite servidor de 96 tests y frontend de 55 tests aprobadas. Después del
límite defensivo de una propuesta nueva y ajuste del hito temporal, se repitieron
los 23 tests de respuestas; build servidor y web correctos. Cobertura de pausa de
600 ms que no libera el turno, reanudación de voz, entrega de la instantánea más
reciente, literal incompleto que no se detecta, pregunta entre segmentos, evidencia
inelegible que no bloquea una respuesta válida, y otra reunión que progresa mientras
una está detenida en el proveedor. Revisión de capturas desktop/móvil sin cambios
de layout; detector mecánico de interfaz sin hallazgos.
