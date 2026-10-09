import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { IdentityModule } from '../identity/identity.module';
import { ChatRateLimiter } from './chat-rate-limiter';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeRelay } from './realtime.relay';

@Module({
  imports: [IdentityModule, ChatModule],
  providers: [RealtimeGateway, RealtimeRelay, ChatRateLimiter],
})
export class RealtimeModule {}
