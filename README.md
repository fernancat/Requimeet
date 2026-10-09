# RequiMeet

Videollamadas grupales orientadas al levantamiento de requerimientos de
software. Core de reuniones con un punto de extensión real de procesamiento
multimedia para módulos futuros (transcripción, preguntas IA, requerimientos).

Diseño y decisiones: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Cómo integrar módulos futuros: [docs/INTEGRACION.md](docs/INTEGRACION.md).

## Stack

- **Backend**: NestJS + Prisma + PostgreSQL (monolito modular, `apps/server`)
- **Frontend**: React + Vite + LiveKit client (`apps/web`)
- **Processor**: consumo de medios con `@livekit/rtc-node` (`apps/processor`)
- **Tiempo real**: Socket.IO (admisión, chat, estado)
- **Media**: LiveKit server (SFU WebRTC)

## Arranque local

Requisitos: Node >= 20, Docker con Compose.

```bash
cp .env.example .env
npm install
npm run build -w packages/contracts
docker compose up -d            # postgres (5432) + livekit (7880, devkey/secret)
npm run prisma:migrate -w apps/server
npm run dev:server              # backend en :3000
npm run dev:processor           # processor interno en :4100
npm run dev:web                 # frontend en :5173
```

El processor también necesita sus variables (mismo `.env` raíz o de entorno):
`INTERNAL_SHARED_SECRET`, `PROCESSOR_PORT`, `SERVER_INTERNAL_URL`. Ver
`apps/processor/.env.example`.

Nota de entorno: en la máquina de desarrollo de este repo, Postgres corre en
el puerto **55440** (no 5432) y `apps/server/.env` ya apunta ahí
(`postgresql://requimeet:requimeet@localhost:55440/requimeet`). Si levantas el
Postgres del compose, ajusta `DATABASE_URL` al 5432.

Flujo: regístrate como anfitrión, crea una reunión, iníciala y comparte el
enlace `/m/<codigo>`. El invitado pasa por pantalla previa y sala de espera;
el anfitrión lo admite desde el panel de participantes.

## Pruebas

```bash
npm test                        # unit + integración (server, processor, web)
```

Los tests de integración del server usan la base `requimeet_test`. Crearla una
vez (puerto del entorno local; ajusta si usas el compose):

```bash
sudo -u postgres createdb requimeet_test   # o: docker exec <pg> createdb -U requimeet requimeet_test
DATABASE_URL=postgresql://requimeet:requimeet@localhost:55440/requimeet_test \
  npx prisma migrate deploy --schema apps/server/prisma/schema.prisma
```

### E2E integral

Con Postgres + LiveKit corriendo y los builds al día (`npm run build`):

```bash
npm run test:e2e
```

El script `scripts/e2e-smoke.mjs` levanta server y processor como hijos,
recorre el flujo completo (admisión, audio real entre dos participantes
sintéticos vía rtc-node, chat con dedupe, reconexión, kick, processing:result
del DemoConsumer, fin de reunión) e imprime PASS/FAIL por paso.

## Estructura

```
apps/server      backend NestJS (módulos: identity, meetings, livekit, chat, realtime, processing)
apps/web         frontend React
apps/processor   consumidor de pistas LiveKit (proceso separado, mismo repo)
packages/contracts  tipos compartidos (API, eventos RT, contrato multimedia)
scripts/e2e-smoke.mjs  prueba E2E integral scriptada
```
