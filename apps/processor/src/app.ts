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

    // Idempotente por meetingId: sesion viva -> 200 con la existente
    const existing = sessions.get(body.meetingId);
    if (existing) {
      if (existing.connectionState() !== 'disconnected') {
        res.status(200).json(existing.info());
        return;
      }
      // Sesion en mal estado: se reinicia
      logger(`sesion ${body.meetingId}: reiniciando (estaba disconnected)`);
      await existing.stop('restart').catch(() => {});
      sessions.delete(body.meetingId);
    }

    const session = deps.sessionFactory(body);
    sessions.set(body.meetingId, session);
    try {
      await session.start();
    } catch (error) {
      sessions.delete(body.meetingId);
      logger(`sesion ${body.meetingId}: no arranco ${String(error)}`);
      res.status(502).json({ error: 'session failed to start' });
      return;
    }
    res.status(201).json(session.info());
  });

  app.delete('/sessions/:meetingId', async (req: Request, res: Response) => {
    const meetingId = String(req.params.meetingId);
    const session = sessions.get(meetingId);
    if (!session) {
      res.status(200).json({ stopped: false });
      return;
    }
    sessions.delete(meetingId);
    await session.stop('requested').catch(() => {});
    res.status(200).json({ stopped: true });
  });

  app.get('/sessions', (_req: Request, res: Response) => {
    res.json([...sessions.values()].map((s) => s.info()));
  });

  return app;
}
