# RequiMeet

Videollamadas grupales orientadas al levantamiento de requerimientos de
software. Core de reuniones con un punto de extensión real de procesamiento
multimedia para módulos futuros (transcripción, preguntas IA, requerimientos).

Diseño y decisiones: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
docker compose up -d            # postgres + livekit (modo dev)
npm run prisma:migrate -w apps/server
npm run dev:server              # backend en :3000
npm run dev:processor           # processor interno en :4100
npm run dev:web                 # frontend en :5173
```

Flujo: regístrate como anfitrión, crea una reunión, iníciala y comparte el
enlace `/m/<codigo>`. El invitado pasa por pantalla previa y sala de espera;
el anfitrión lo admite desde el panel de participantes.

## Pruebas

```bash
npm test                        # unit tests (server, processor)
```

Las pruebas de audio/video real requieren navegador y LiveKit en ejecución;
ver el informe en docs/ARCHITECTURE.md y la sección de pruebas pendientes.

## Estructura

```
apps/server      backend NestJS (módulos: identity, meetings, livekit, chat, realtime, processing)
apps/web         frontend React
apps/processor   consumidor de pistas LiveKit (proceso separado, mismo repo)
packages/contracts  tipos compartidos (API, eventos RT, contrato multimedia)
```
