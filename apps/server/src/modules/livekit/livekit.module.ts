import { Module } from '@nestjs/common';
import { LivekitEventsListener } from './livekit-events.listener';
import { LivekitRoomService } from './livekit-room.service';
import { LivekitTokenService } from './livekit-token.service';
import { LivekitWebhookController } from './livekit-webhook.controller';

@Module({
  controllers: [LivekitWebhookController],
  providers: [LivekitTokenService, LivekitRoomService, LivekitEventsListener],
  exports: [LivekitTokenService, LivekitRoomService],
})
export class LivekitModule {}
