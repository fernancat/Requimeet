import { ConfigService } from '@nestjs/config';
import { Meeting, Participant } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { LivekitTokenService, parseTtlSeconds } from './livekit-token.service';

const SECRET = 'test-livekit-secret';

function buildService(ttl = '5m') {
  return new LivekitTokenService(
    new ConfigService({
      LIVEKIT_URL: 'ws://localhost:7880',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: SECRET,
      LIVEKIT_TOKEN_TTL: ttl,
    }),
  );
}

const meeting = {
  id: 'meeting-1',
  code: 'ABCDE23456',
} as Meeting;
const participant = {
  id: 'participant-1',
  displayName: 'Ana',
  role: 'host',
} as Participant;

describe('parseTtlSeconds', () => {
  it('parsea s/m/h y default segundos', () => {
    expect(parseTtlSeconds('5m')).toBe(300);
    expect(parseTtlSeconds('90s')).toBe(90);
    expect(parseTtlSeconds('90')).toBe(90);
    expect(parseTtlSeconds('1h')).toBe(3600);
    expect(() => parseTtlSeconds('cinco')).toThrow();
  });
});

describe('LivekitTokenService', () => {
  it('emite JWT con identity estable, grants y TTL corto', async () => {
    const service = buildService();
    const result = await service.createParticipantToken(meeting, participant);

    expect(result.livekitUrl).toBe('ws://localhost:7880');
    expect(result.expiresInSec).toBe(300);

    const decoded = jwt.verify(result.token, SECRET) as jwt.JwtPayload;
    expect(decoded.sub).toBe('participant-1');
    expect(decoded.name).toBe('Ana');
    expect(decoded.iss).toBe('devkey');
    expect(JSON.parse(decoded.metadata as string)).toEqual({
      participantId: 'participant-1',
      role: 'host',
      meetingId: 'meeting-1',
    });
    const video = decoded.video as Record<string, unknown>;
    expect(video).toMatchObject({
      roomJoin: true,
      room: 'ABCDE23456',
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    const ttl = (decoded.exp ?? 0) - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(240);
    expect(ttl).toBeLessThanOrEqual(310);
  });

  it('sin credenciales falla con error claro', async () => {
    const service = new LivekitTokenService(new ConfigService({}));
    await expect(
      service.createParticipantToken(meeting, participant),
    ).rejects.toThrow(/LIVEKIT_API_KEY/);
  });
});
