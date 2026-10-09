import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { HostPrincipal } from './auth.types';

type AuthenticatedRequest = Request & { user?: HostPrincipal };

@Injectable()
export class HostAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    let payload;
    try {
      payload = this.authService.verifyHostToken(header.slice(7));
    } catch {
      throw new UnauthorizedException('invalid token');
    }
    req.user = { hostUserId: payload.sub };
    return true;
  }
}
