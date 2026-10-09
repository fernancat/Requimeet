import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { GuestPrincipal } from './auth.types';
import { GuestTokenService } from './guest-token.service';

type GuestRequest = Request & { guest?: GuestPrincipal };

@Injectable()
export class GuestAuthGuard implements CanActivate {
  constructor(private readonly guestTokens: GuestTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GuestRequest>();
    const meetingCode = req.params.code;
    if (typeof meetingCode !== 'string' || !meetingCode) {
      throw new UnauthorizedException('missing meeting code in route');
    }
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const payload = this.guestTokens.verify(header.slice(7), meetingCode);
    req.guest = {
      guestSessionId: payload.sub,
      meetingCode: payload.meetingCode,
    };
    return true;
  }
}
