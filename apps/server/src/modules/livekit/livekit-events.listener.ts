import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS, MeetingLifecyclePayload } from '../meetings/meetings.events';
import { LivekitRoomService } from './livekit-room.service';

@Injectable()
export class LivekitEventsListener {
  private readonly logger = new Logger(LivekitEventsListener.name);

  constructor(private readonly rooms: LivekitRoomService) {}

  @OnEvent(DOMAIN_EVENTS.meetingEnded)
  async onMeetingEnded(payload: MeetingLifecyclePayload): Promise<void> {
    this.logger.log(`reunion ${payload.code} finalizada: borrando sala SFU`);
    await this.rooms.deleteRoom(payload.code);
  }
}
