import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { StartProcessingRequest } from '@requimeet/contracts';
import { AccessToken } from 'livekit-server-sdk';
import {
  DOMAIN_EVENTS,
  MeetingLifecyclePayload,
} from '../meetings/meetings.events';

const PROCESSOR_TOKEN_TTL = '6h';
const MAX_ATTEMPTS = 2;

/**
 * Orquesta el proceso `processor`: al iniciar la reunion emite un token
 * LiveKit oculto (solo suscripcion) y ordena iniciar la sesion; al finalizar
 * ordena detenerla. Si el processor esta caido se loguea y la reunion sigue.
 *
 * El token del processor vive 6h (toda la reunion); no se renueva: si la
 * reunion dura mas, el processor se desconecta y la sesion se reinicia al
 * proximo meeting.started (idempotente por meetingId).
 */
@Injectable()
export class ProcessingOrchestrator {
  private readonly logger = new Logger(ProcessingOrchestrator.name);
  private readonly processorUrl: string;
  private readonly secret?: string;
  private readonly enableVideo: boolean;
  private readonly livekitUrl: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;

  constructor(config: ConfigService) {
    this.processorUrl = config.get<string>(
      'PROCESSOR_INTERNAL_URL',
      'http://localhost:4100',
    );
    this.secret = config.get<string>('INTERNAL_SHARED_SECRET');
    this.enableVideo = config.get<string>('PROCESSOR_ENABLE_VIDEO') === 'true';
    this.livekitUrl = config.get<string>('LIVEKIT_URL', 'ws://localhost:7880');
    this.apiKey = config.get<string>('LIVEKIT_API_KEY');
    this.apiSecret = config.get<string>('LIVEKIT_API_SECRET');
  }

  @OnEvent(DOMAIN_EVENTS.meetingStarted)
  async onMeetingStarted(payload: MeetingLifecyclePayload): Promise<void> {
    if (!this.secret || !this.apiKey || !this.apiSecret) {
      this.logger.warn('credenciales internas/LiveKit ausentes: processor no arranca');
      return;
    }
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: `processor-${payload.meetingId}`,
      name: 'requimeet-processor',
      ttl: PROCESSOR_TOKEN_TTL,
    });
    token.addGrant({
      roomJoin: true,
      room: payload.code,
      canSubscribe: true,
      canPublish: false,
      canPublishData: false,
      hidden: true,
    });
    const request: StartProcessingRequest = {
      meetingId: payload.meetingId,
      roomName: payload.code,
      livekitUrl: this.livekitUrl,
      processorToken: await token.toJwt(),
      enableVideo: this.enableVideo,
    };
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`${this.processorUrl}/sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': this.secret,
          },
          body: JSON.stringify(request),
        });
        if (res.ok) {
          this.logger.log(`sesion de procesamiento iniciada para ${payload.code}`);
          return;
        }
        this.logger.warn(`processor respondio ${res.status} al iniciar sesion`);
      } catch (error) {
        this.logger.warn(`processor inalcanzable (${String(error)})`);
      }
    }
    this.logger.warn(`no se pudo iniciar el procesamiento de ${payload.code}; la reunion continua`);
  }

  @OnEvent('meeting.closing')
  async onMeetingEnded(payload: MeetingLifecyclePayload): Promise<void> {
    if (!this.secret) return;
    try {
      await fetch(`${this.processorUrl}/sessions/${payload.meetingId}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(15000),
        headers: { 'x-internal-secret': this.secret },
      });
    } catch (error) {
      this.logger.warn(`no se pudo detener la sesion del processor (${String(error)})`);
    }
  }
}
