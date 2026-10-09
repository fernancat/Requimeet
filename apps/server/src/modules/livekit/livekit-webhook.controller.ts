import {
  Controller,
  Headers,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { WebhookReceiver } from 'livekit-server-sdk';
import { DOMAIN_EVENTS } from '../meetings/meetings.events';

const MAX_PROCESSED_IDS = 5000;

export interface WebhookResult {
  received: boolean;
  duplicate?: boolean;
}

@Controller('webhooks')
export class LivekitWebhookController {
  private readonly logger = new Logger(LivekitWebhookController.name);
  private readonly receiver: WebhookReceiver;
  /** Ids de eventos ya procesados (idempotencia); FIFO acotado. */
  private readonly processedIds = new Set<string>();

  constructor(
    config: ConfigService,
    private readonly events: EventEmitter2,
  ) {
    const apiKey = config.get<string>('LIVEKIT_API_KEY');
    const apiSecret = config.get<string>('LIVEKIT_API_SECRET');
    if (!apiKey || !apiSecret) {
      throw new Error(
        'LIVEKIT_API_KEY/LIVEKIT_API_SECRET no configuradas: webhook inhabilitado',
      );
    }
    this.receiver = new WebhookReceiver(apiKey, apiSecret);
  }

  @Post('livekit')
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') auth?: string,
  ): Promise<WebhookResult> {
    const rawBody = req.rawBody?.toString('utf8');
    if (!rawBody) {
      throw new UnauthorizedException('missing raw body');
    }
    let event;
    try {
      event = await this.receiver.receive(rawBody, auth);
    } catch {
      throw new UnauthorizedException('invalid webhook signature');
    }

    if (event.id && this.processedIds.has(event.id)) {
      return { received: true, duplicate: true };
    }
    if (event.id) {
      this.processedIds.add(event.id);
      if (this.processedIds.size > MAX_PROCESSED_IDS) {
        const oldest = this.processedIds.values().next().value;
        if (oldest !== undefined) {
          this.processedIds.delete(oldest);
        }
      }
    }

    // El webhook participant_disconnected nunca finaliza la reunion;
    // la reconciliacion se hace revalidando en cada media-token.
    this.logger.log(
      `livekit ${event.event} room=${event.room?.name ?? '-'} participant=${event.participant?.identity ?? '-'}`,
    );
    this.events.emit(DOMAIN_EVENTS.livekitEvent, {
      eventId: event.id,
      event: event.event,
      room: event.room?.name ?? null,
      participantIdentity: event.participant?.identity ?? null,
    });
    return { received: true };
  }
}
