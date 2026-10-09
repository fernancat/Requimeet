import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as jwt from 'jsonwebtoken';
import { LivekitWebhookController } from './livekit-webhook.controller';

const SECRET = 'test-livekit-secret';

function sign(body: string, secret = SECRET): string {
  const sha256 = createHash('sha256').update(body).digest('base64');
  return jwt.sign({ sha256 }, secret, {
    issuer: 'devkey',
    expiresIn: '5m',
  });
}

function buildController() {
  const events = new EventEmitter2();
  const controller = new LivekitWebhookController(
    new ConfigService({ LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: SECRET }),
    events,
  );
  return { controller, emitSpy: jest.spyOn(events, 'emit') };
}

function fakeReq(body: string) {
  return { rawBody: Buffer.from(body, 'utf8') } as never;
}

const eventBody = (id: string) =>
  JSON.stringify({
    event: 'participant_joined',
    id,
    room: { name: 'ABCDE23456' },
    participant: { identity: 'participant-1' },
  });

describe('LivekitWebhookController', () => {
  it('evento firmado se procesa y emite livekit.event', async () => {
    const { controller, emitSpy } = buildController();
    const body = eventBody('evt-1');

    const result = await controller.handle(fakeReq(body), sign(body));

    expect(result).toEqual({ received: true });
    expect(emitSpy).toHaveBeenCalledWith(
      'livekit.event',
      expect.objectContaining({
        eventId: 'evt-1',
        event: 'participant_joined',
        room: 'ABCDE23456',
        participantIdentity: 'participant-1',
      }),
    );
  });

  it('el mismo evento reenviado se ignora como duplicado', async () => {
    const { controller, emitSpy } = buildController();
    const body = eventBody('evt-2');
    await controller.handle(fakeReq(body), sign(body));
    emitSpy.mockClear();

    const result = await controller.handle(fakeReq(body), sign(body));

    expect(result).toEqual({ received: true, duplicate: true });
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('firma invalida da 401', async () => {
    const { controller } = buildController();
    const body = eventBody('evt-3');

    await expect(
      controller.handle(fakeReq(body), sign(body, 'otro-secret')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.handle(fakeReq(body), undefined),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
