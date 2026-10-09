import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../identity/auth.service';
import { GuestTokenService } from '../identity/guest-token.service';

export type Caller =
  | { kind: 'host'; hostUserId: string }
  | { kind: 'guest'; guestSessionId: string };

/** Resuelve el Bearer de la request como host o como invitado de :code. */
@Injectable()
export class CallerResolver {
  constructor(
    private readonly authService: AuthService,
    private readonly guestTokens: GuestTokenService,
  ) {}

  resolve(req: Request, code: string): Caller {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }
    try {
      const host = this.authService.verifyHostToken(token);
      return { kind: 'host', hostUserId: host.sub };
    } catch {
      // no es token de host; se intenta como invitado
    }
    const guest = this.guestTokens.verify(token, code);
    return { kind: 'guest', guestSessionId: guest.sub };
  }
}
