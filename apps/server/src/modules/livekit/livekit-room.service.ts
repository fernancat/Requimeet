import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';

export interface MuteResult {
  muted: boolean;
  reason?: string;
}

@Injectable()
export class LivekitRoomService {
  private readonly logger = new Logger(LivekitRoomService.name);
  private client?: RoomServiceClient;

  constructor(private readonly config: ConfigService) {}

  /**
   * Expulsa al participante del SFU. Tolera que no este conectado:
   * la expulsion de negocio ya quedo persistida en PostgreSQL.
   * Nota: LiveKit OSS no revoca tokens ya emitidos; la ventana residual
   * es <= LIVEKIT_TOKEN_TTL y toda renovacion pasa por media-token,
   * que revalida contra la base de datos.
   */
  async removeParticipant(room: string, identity: string): Promise<void> {
    try {
      await this.getClient().removeParticipant(room, identity);
    } catch (error) {
      this.logger.warn(
        `removeParticipant ${identity} en ${room} fallo (se continua): ${String(error)}`,
      );
    }
  }

  /** Silencia el microfono a nivel SFU. Nunca hace unmute. */
  async muteMicrophone(room: string, identity: string): Promise<MuteResult> {
    let participant;
    try {
      participant = await this.getClient().getParticipant(room, identity);
    } catch {
      return { muted: false, reason: 'not-connected' };
    }
    const micTrack = participant.tracks.find(
      (t) => t.source === TrackSource.MICROPHONE,
    );
    if (!micTrack) {
      return { muted: false, reason: 'no-mic-track' };
    }
    await this.getClient().mutePublishedTrack(room, identity, micTrack.sid, true);
    return { muted: true };
  }

  /** Borra la sala (desconecta a todos). Tolera que la sala no exista. */
  async deleteRoom(room: string): Promise<void> {
    try {
      await this.getClient().deleteRoom(room);
    } catch (error) {
      this.logger.warn(`deleteRoom ${room} fallo (se continua): ${String(error)}`);
    }
  }

  private getClient(): RoomServiceClient {
    if (!this.client) {
      const url = this.config.get<string>('LIVEKIT_URL', 'ws://localhost:7880');
      const apiKey = this.config.get<string>('LIVEKIT_API_KEY');
      const apiSecret = this.config.get<string>('LIVEKIT_API_SECRET');
      if (!apiKey || !apiSecret) {
        throw new Error(
          'LIVEKIT_API_KEY/LIVEKIT_API_SECRET no configuradas: no se puede usar RoomService',
        );
      }
      const host = url.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
      this.client = new RoomServiceClient(host, apiKey, apiSecret);
    }
    return this.client;
  }
}
