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
