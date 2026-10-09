import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LivekitModule } from '../livekit/livekit.module';
import { MeetingParticipantsService } from './meeting-participants.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [IdentityModule, LivekitModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingParticipantsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}
