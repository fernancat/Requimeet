import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import type { MediaTokenResponse } from '@requimeet/contracts';
import { Meeting, Participant } from '@prisma/client';

export function parseTtlSeconds(value: string): number {
  const match = /^(\d+)([smh]?)$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid TTL format: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return amount * 60;
  if (unit === 'h') return amount * 3600;
  return amount;
}

@Injectable()
export class LivekitTokenService {
  private readonly url: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly ttl: string;

  constructor(config: ConfigService) {
    this.url = config.get<string>('LIVEKIT_URL', 'ws://localhost:7880');
    this.apiKey = config.get<string>('LIVEKIT_API_KEY');
    this.apiSecret = config.get<string>('LIVEKIT_API_SECRET');
    this.ttl = config.get<string>('LIVEKIT_TOKEN_TTL', '5m');
  }

  async createParticipantToken(
    meeting: Meeting,
    participant: Participant,
  ): Promise<MediaTokenResponse> {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error(
        'LIVEKIT_API_KEY/LIVEKIT_API_SECRET no configuradas: no se pueden emitir tokens',
      );
    }
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: participant.id,
      name: participant.displayName,
      metadata: JSON.stringify({
        participantId: participant.id,
        role: participant.role,
        meetingId: meeting.id,
      }),
      ttl: this.ttl,
    });
    token.addGrant({
      roomJoin: true,
      room: meeting.code,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return {
      token: await token.toJwt(),
      livekitUrl: this.url,
      expiresInSec: parseTtlSeconds(this.ttl),
    };
  }
}
