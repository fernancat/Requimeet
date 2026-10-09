import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { AppModule } from '../../app.module';
import { AuthService } from '../identity/auth.service';
import { MeetingsService } from './meetings.service';
import { JoinRequestRateLimiter } from './join-request-rate-limiter';
import { PrismaService } from '../../prisma/prisma.service';
import { cleanDb, TEST_DATABASE_URL } from '../../test-utils/test-db';

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'secret';

describe('Rate limit de join-requests (integracion)', () => {
  let app: INestApplication;
  let port: number;
  let code: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    const prisma = app.get(PrismaService);
    await cleanDb(prisma);
    const auth = app.get(AuthService);
    const meetings = app.get(MeetingsService);
    const { user } = await auth.register({
      email: `rl-${Date.now()}@example.com`,
      password: 'password123',
      displayName: 'Host RL',
    });
    const meeting = await meetings.create(user.id, { title: 'RL' });
    await meetings.start(user.id, meeting.code);
    code = meeting.code;
  });

  afterAll(async () => {
    await app.close();
  });

  it('la 11a solicitud en un minuto da 429', async () => {
    app.get(JoinRequestRateLimiter).reset();
    const url = `http://127.0.0.1:${port}/api/meetings/${code}/join-requests`;

    for (let i = 1; i <= 10; i++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: `G${i}` }),
      });
      expect(res.status).toBe(201);
    }
    const eleventh = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'G11' }),
    });
    expect(eleventh.status).toBe(429);
    app.get(JoinRequestRateLimiter).reset();
  });
});
