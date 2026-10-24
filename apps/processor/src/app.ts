import { withTimeout } from './timeout';
import express, { Express, NextFunction, Request, Response } from 'express';
import type {
  ProcessingSessionInfo,
  StartProcessingRequest,
} from '@requimeet/contracts';

export interface SessionHandle {
  meetingId: string;
  connectionState(): ProcessingSessionInfo['connectionState'];
  info(): ProcessingSessionInfo;
  start(): Promise<void>;
  stop(reason: string): Promise<void>;
  /** Opcional: aviso de desconexion final para limpieza del registro. */
  onFinalDisconnect?: (() => void) | null;
}

export type SessionFactory = (request: StartProcessingRequest) => SessionHandle;

export interface AppDeps {
  internalSecret: string;
  sessionFactory: SessionFactory;
  logger?: (msg: string) => void;
}

export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? (() => {});
  const sessions = new Map<string, SessionHandle>();
  const pending = new Map<string, Promise<void>>();
  async function locked(id: string, work: () => Promise<void>) {
    const previous = pending.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    pending.set(id, next);
    try { await next; } finally { if (pending.get(id) === next) pending.delete(id); }
  }
  const app = express();
  app.use(express.json());

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers['x-internal-secret'] !== deps.internalSecret) {
      res.status(401).json({ error: 'invalid internal secret' });
      return;
    }
    next();
  });

  app.post('/sessions', async (req: Request, res: Response) => {
    const body = req.body as StartProcessingRequest;
    if (
      !body?.meetingId ||
      !body?.roomName ||
      !body?.livekitUrl ||
      !body?.processorToken
    ) {
      res.status(400).json({ error: 'meetingId, roomName, livekitUrl y processorToken son obligatorios' });
      return;
    }

    await locked(body.meetingId, async () => {
      // Idempotente por meetingId: sesion viva -> 200 con la existente
      const existing = sessions.get(body.meetingId);
      if (existing) {
        if (!body.restart && existing.connectionState() !== 'disconnected') {
          res.status(200).json(existing.info());
          return;
        }
        // Sesion en mal estado: se reinicia
        logger(`sesion ${body.meetingId}: reiniciando (recuperación solicitada o desconexión)`);
        await withTimeout(existing.stop('restart'), 12000, 'session stop timeout').catch(error => logger(String(error)));
        sessions.delete(body.meetingId);
      }

      const session = deps.sessionFactory(body);
      sessions.set(body.meetingId, session);
      session.onFinalDisconnect = () => {
        if (sessions.get(body.meetingId) === session) {
          sessions.delete(body.meetingId);
          logger(`sesion ${body.meetingId}: descartada tras desconexion final`);
        }
      };
      try {
        await withTimeout(session.start(), 15000, 'session start timeout');
      } catch (error) {
        if (sessions.get(body.meetingId) === session) sessions.delete(body.meetingId);
        void session.stop('start-failed').catch(() => {});
        logger(`sesion ${body.meetingId}: no arranco ${String(error)}`);
        res.status(502).json({ error: 'session failed to start' });
        return;
      }
      res.status(201).json(session.info());
    });
  });

  app.delete('/sessions/:meetingId', async (req: Request, res: Response) => {
    const meetingId = String(req.params.meetingId);
    await locked(meetingId, async () => {
      const session = sessions.get(meetingId);
      if (!session) {
        res.status(200).json({ stopped: false });
        return;
      }
      sessions.delete(meetingId);
      await withTimeout(session.stop('requested'), 12000, 'session stop timeout').catch(error => logger(String(error)));
      res.status(200).json({ stopped: true });
    });
  });

  app.get('/sessions', (_req: Request, res: Response) => {
    res.json([...sessions.values()].map((s) => s.info()));
  });

  return app;
}
