import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { StringValue } from 'ms';
import { GuestTokenPayload } from './auth.types';

@Injectable()
export class GuestTokenService {
  private readonly jwt: JwtService;

  constructor(config: ConfigService) {
    this.jwt = new JwtService({
      secret: config.get<string>('GUEST_TOKEN_SECRET', 'dev-guest-secret'),
      signOptions: {
        expiresIn: config.get<string>('GUEST_TOKEN_TTL', '30m') as StringValue,
      },
    });
  }

  issue(guestSessionId: string, meetingCode: string): string {
    return this.jwt.sign({ sub: guestSessionId, kind: 'guest', meetingCode });
  }

  verify(token: string, meetingCode: string): GuestTokenPayload {
    const payload = this.verifyAny(token);
    if (payload.meetingCode !== meetingCode) {
      throw new UnauthorizedException('guest token not valid for this meeting');
    }
    return payload;
  }

  /** Verifica sin atar a un meetingCode (el token ya lo lleva; p.ej. handshake de socket). */
  verifyAny(token: string): GuestTokenPayload {
    let payload: GuestTokenPayload;
    try {
      payload = this.jwt.verify<GuestTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('invalid guest token');
    }
    if (payload.kind !== 'guest') {
      throw new UnauthorizedException('not a guest token');
    }
    return payload;
  }
}
