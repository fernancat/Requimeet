import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { JoinRequestRateLimiter } from './join-request-rate-limiter';

/** 429 si la IP supera ~10 solicitudes de ingreso por minuto. */
@Injectable()
export class JoinRequestThrottleGuard implements CanActivate {
  constructor(private readonly limiter: JoinRequestRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (!this.limiter.consume(key)) {
      throw new HttpException(
        'too many join requests, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
