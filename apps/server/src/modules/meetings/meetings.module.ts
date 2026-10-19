import { MeetingAccessService } from './meeting-access.service';
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LivekitModule } from '../livekit/livekit.module';
import { CallerResolver } from './caller-resolver';
import { JoinRequestRateLimiter } from './join-request-rate-limiter';
import { JoinRequestThrottleGuard } from './join-request-throttle.guard';
import { MeetingParticipantsService } from './meeting-participants.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  imports: [IdentityModule, LivekitModule],
  controllers: [MeetingsController],
  providers: [
    MeetingAccessService,
    MeetingsService,
    MeetingParticipantsService,
    CallerResolver,
    JoinRequestRateLimiter,
    JoinRequestThrottleGuard,
  ],
  exports: [MeetingsService, CallerResolver, MeetingAccessService],
})
export class MeetingsModule {}
