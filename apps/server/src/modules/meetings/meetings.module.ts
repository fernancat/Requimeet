import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LivekitModule } from '../livekit/livekit.module';
import { CallerResolver } from './caller-resolver';
import { MeetingParticipantsService } from './meeting-participants.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [IdentityModule, LivekitModule],
  controllers: [MeetingsController],
  providers: [MeetingsService, MeetingParticipantsService, CallerResolver],
  exports: [MeetingsService, CallerResolver],
})
export class MeetingsModule {}
