import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GuestTokenService } from './guest-token.service';

function buildService() {
  return new GuestTokenService(
    new ConfigService({
      GUEST_TOKEN_SECRET: 'guest-test-secret',
      GUEST_TOKEN_TTL: '30m',
    }),
  );
}

describe('GuestTokenService', () => {
  it('roundtrip emit/verify', () => {
    const service = buildService();
    const token = service.issue('guest-1', 'ABC123');

    const payload = service.verify(token, 'ABC123');

    expect(payload.sub).toBe('guest-1');
    expect(payload.kind).toBe('guest');
    expect(payload.meetingCode).toBe('ABC123');
  });

  it('token de otro meetingCode no verifica', () => {
    const service = buildService();
    const token = service.issue('guest-1', 'ABC123');

    expect(() => service.verify(token, 'XYZ999')).toThrow(
      UnauthorizedException,
    );
  });

  it('token corrupto rechazado', () => {
    const service = buildService();

    expect(() => service.verify('no.es.un.token', 'ABC123')).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      service.verify('aaa.bbb.ccc'.repeat(3), 'ABC123'),
    ).toThrow(UnauthorizedException);
  });
});
