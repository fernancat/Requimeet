import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/** Exige el header x-internal-secret (processor <-> backend). */
@Injectable()
export class InternalSecretGuard implements CanActivate {
  private readonly secret?: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('INTERNAL_SHARED_SECRET');
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.secret) {
      throw new UnauthorizedException('INTERNAL_SHARED_SECRET no configurada');
    }
    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers['x-internal-secret'] !== this.secret) {
      throw new UnauthorizedException('invalid internal secret');
    }
    return true;
  }
}
