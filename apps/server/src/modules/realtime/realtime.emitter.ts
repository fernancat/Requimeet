import { Injectable } from '@nestjs/common';
import { meetingRoom, RealtimeGateway } from './realtime.gateway';

/** Punto unico para que otros modulos emitan a una room sin conocer el gateway. */
@Injectable()
export class RealtimeEmitter {
  constructor(private readonly gateway: RealtimeGateway) {}

  toMeeting(code: string, event: string, payload: unknown): void {
    this.gateway.server.to(meetingRoom(code)).emit(event, payload);
  }
}
