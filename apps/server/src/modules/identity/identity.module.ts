import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GuestAuthGuard } from './guest-auth.guard';
import { GuestTokenService } from './guest-token.service';
import { HostAuthGuard } from './host-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    GuestTokenService,
    HostAuthGuard,
    GuestAuthGuard,
  ],
  exports: [AuthService, GuestTokenService, HostAuthGuard, GuestAuthGuard],
})
export class IdentityModule {}
