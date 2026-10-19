import {
  AudioStream,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  TrackKind,
  TrackSource as SdkTrackSource,
  VideoStream,
} from '@livekit/rtc-node';
import type {
  AudioFrame,
  MediaConsumer,
  ParticipantRef,
  ProcessingSessionInfo,
  StartProcessingRequest,
  TrackRef,
  TrackSource,
  VideoFrame,
} from '@requimeet/contracts';
import { ConsumerPipeline } from './consumer-pipeline';

export type SessionConnectionState = ProcessingSessionInfo['connectionState'];

interface SubscribedTrack {
  ref: TrackRef;
  cancel: () => void;
}

/** Permite inyectar una Room falsa en tests. */
export type RoomFactory = () => Room;

/**
 * Sesion de procesamiento: conecta a la sala como participante oculto,
 * suscribe pistas y alimenta a los consumidores registrados.
 *
 * Nota: `mediaTimeMs` se acumula localmente por pista (los typings del SDK
 * no exponen timestamp RTP); no promete sincronizacion entre participantes.
 */
export class MediaSession {
  readonly meetingId: string;
  /** Se invoca tras una desconexion final de LiveKit (no una reconexion). */
  onFinalDisconnect: (() => void) | null = null;
  private state: SessionConnectionState = 'connecting';
  private readonly startedAtMs = Date.now();
  private readonly pipelines: ConsumerPipeline[];
  private readonly tracks = new Map<string, SubscribedTrack>();
  private readonly mediaTimeByTrack = new Map<string, number>();
  private room: Room | null = null;
  private stopping = false;

  constructor(
    private readonly request: StartProcessingRequest,
    consumers: MediaConsumer[],
    private readonly logger: (msg: string) => void = () => {},
    private readonly roomFactory: RoomFactory = () => new Room(),
  ) {
    this.meetingId = request.meetingId;
    this.pipelines = consumers.map(
      (consumer, i) =>
        new ConsumerPipeline(consumer, `${consumer.constructor.name}#${i}`, logger),
    );
  }

  connectionState(): SessionConnectionState {
    return this.state;
  }

  droppedFrames(): number {
    return this.pipelines.reduce((acc, p) => acc + p.droppedCount, 0);
  }

  info(): ProcessingSessionInfo {
    return {
      meetingId: this.meetingId,
      roomName: this.request.roomName,
      startedAtMs: this.startedAtMs,
      subscribedTracks: this.tracks.size,
      connectionState: this.state,
    };
  }

  async start(): Promise<void> {
    this.pipelines.forEach((p) => p.start());
    this.dispatchEvent((c) =>
      c.onSessionStart?.({ meetingId: this.meetingId, startedAtMs: this.startedAtMs }),
    );

    const room = this.roomFactory();
    this.room = room;
    this.wireRoomEvents(room);
    try {
      await room.connect(this.request.livekitUrl, this.request.processorToken);
      this.state = 'connected';
      this.logger(`sesion ${this.meetingId}: conectada a ${this.request.roomName}`);
    } catch (error) {
      this.state = 'disconnected';
      this.logger(`sesion ${this.meetingId}: fallo de conexion ${String(error)}`);
      throw error;
    }

    for (const participant of room.remoteParticipants.values()) {
      this.handleParticipantConnected(participant);
    }
  }

  async stop(reason: string): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.state = 'disconnected';
    for (const entry of this.tracks.values()) {
      entry.cancel();
    }
    this.tracks.clear();
    try {
      await this.room?.disconnect();
    } catch (error) {
      this.logger(`sesion ${this.meetingId}: error en disconnect ${String(error)}`);
    }
    this.dispatchEvent((c) =>
      c.onSessionEnd?.({ meetingId: this.meetingId, endedAtMs: Date.now(), reason }),
    );
    await Promise.all(this.pipelines.map((p) => p.close()));
    this.logger(`sesion ${this.meetingId}: detenida (${reason})`);
  }

  private wireRoomEvents(room: Room): void {
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) =>
      this.handleParticipantConnected(p),
    );
    room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      this.dispatchEvent((c) => c.onParticipantDisconnected?.(this.toParticipantRef(p)));
    });
    room.on(
      RoomEvent.TrackPublished,
      (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        const kind = publication.kind;
        if (kind === TrackKind.KIND_VIDEO && !this.request.enableVideo) {
          // Audio siempre; video solo si enableVideo (ahorra ancho de banda)
          try {
            publication.setSubscribed(false);
          } catch {
            // best effort
          }
          return;
        }
        const ref = this.toTrackRef(publication, participant);
        if (ref) this.dispatchEvent((c) => c.onTrackPublished?.(ref));
      },
    );
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) =>
        this.handleTrackSubscribed(track, publication, participant),
    );
    room.on(
      RoomEvent.TrackUnsubscribed,
      (_track: RemoteTrack, publication: RemoteTrackPublication) =>
        this.releaseTrack(publication.sid, 'unsubscribed'),
    );
    room.on(RoomEvent.TrackUnpublished, (publication: RemoteTrackPublication) =>
      this.releaseTrack(publication.sid, 'unpublished'),
    );
    room.on(RoomEvent.TrackMuted, (publication, participant) => {
      const ref = this.toTrackRef(
        publication as RemoteTrackPublication,
        participant as RemoteParticipant,
      );
      if (ref) this.dispatchEvent((c) => c.onTrackMuted?.(ref));
    });
    room.on(RoomEvent.Reconnecting, () => {
      this.state = 'reconnecting';
    });
    room.on(RoomEvent.Reconnected, () => {
      this.state = 'connected';
    });
    room.on(RoomEvent.Disconnected, () => {
      this.state = 'disconnected';
      this.logger(`sesion ${this.meetingId}: desconectada de LiveKit`);
      // Libera recursos y avisa al registro para no dejar sesiones zombie
      void this.stop('disconnected').finally(() => this.onFinalDisconnect?.());
    });
  }

  private handleParticipantConnected(participant: RemoteParticipant): void {
    this.dispatchEvent((c) => c.onParticipantConnected?.(this.toParticipantRef(participant)));
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind === TrackKind.KIND_VIDEO && !this.request.enableVideo) {
        try {
          (publication as RemoteTrackPublication).setSubscribed(false);
        } catch {
          // best effort
        }
      }
    }
  }

  private handleTrackSubscribed(
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
  ): void {
    if (this.stopping) return;
    const sid = publication.sid ?? track.sid;
    if (!sid) return;
    const isAudio = publication.kind === TrackKind.KIND_AUDIO;
    const isVideo = publication.kind === TrackKind.KIND_VIDEO;
    if (!isAudio && !(isVideo && this.request.enableVideo)) return;

    // Reconexion: el SDK re-suscribe por trackSid; cerrar el stream viejo primero
    this.releaseTrack(sid, 'resubscribed');

    const ref = this.toTrackRef(publication, participant, sid);
    if (!ref) return;
    this.mediaTimeByTrack.set(sid, 0);

    if (isAudio) {
      const stream = new AudioStream(track);
      this.tracks.set(sid, {
        ref,
        cancel: () => void stream.cancel().catch(() => {}),
      });
      void this.pumpAudio(sid, ref, stream);
    } else {
      const stream = new VideoStream(track);
      this.tracks.set(sid, {
        ref,
        cancel: () => void stream.cancel().catch(() => {}),
      });
      void this.pumpVideo(sid, ref, stream);
    }
  }

  private releaseTrack(sid: string | undefined, reason: string): void {
    if (!sid) return;
    const entry = this.tracks.get(sid);
    if (!entry) return;
    entry.cancel();
    this.tracks.delete(sid);
    this.mediaTimeByTrack.delete(sid);
    if (reason !== 'resubscribed') {
      this.dispatchEvent((c) => c.onTrackUnpublished?.(entry.ref));
    }
  }

  private async pumpAudio(
    sid: string,
    ref: TrackRef,
    stream: AudioStream,
  ): Promise<void> {
    try {
      for await (const frame of stream) {
        if (this.stopping) break;
        const durationMs = (frame.samplesPerChannel / frame.sampleRate) * 1000;
        const mediaTimeMs = this.mediaTimeByTrack.get(sid) ?? 0;
        this.mediaTimeByTrack.set(sid, mediaTimeMs + durationMs);
        const audioFrame: AudioFrame = {
          track: ref,
          format: 'pcm16',
          sampleRateHz: frame.sampleRate,
          channels: frame.channels,
          durationMs,
          mediaTimeMs,
          receivedAtMs: Date.now(),
          samples: frame.data,
        };
        this.dispatchFrame({ type: 'audio', frame: audioFrame });
      }
    } catch {
      // stream cancelado al liberar la pista o cerrar la sesion
    }
  }

  private async pumpVideo(
    sid: string,
    ref: TrackRef,
    stream: VideoStream,
  ): Promise<void> {
    try {
      for await (const event of stream) {
        const mediaTimeMs = this.mediaTimeByTrack.get(sid) ?? 0;
        this.mediaTimeByTrack.set(sid, mediaTimeMs + 33);
        const videoFrame: VideoFrame = {
          track: ref,
          width: event.frame.width,
          height: event.frame.height,
          format: String(event.frame.type),
          mediaTimeMs,
          receivedAtMs: Date.now(),
          data: event.frame.data,
        };
        this.dispatchFrame({ type: 'video', frame: videoFrame });
      }
    } catch {
      // stream cancelado
    }
  }

  private toParticipantRef(participant: RemoteParticipant): ParticipantRef {
    let participantId = participant.identity;
    let role: 'host' | 'participant' = 'participant';
    try {
      const meta = JSON.parse(participant.metadata) as {
        participantId?: string;
        role?: 'host' | 'participant';
      };
      if (meta.participantId) participantId = meta.participantId;
      if (meta.role) role = meta.role;
    } catch {
      // sin metadata: identity como fallback
    }
    return {
      meetingId: this.meetingId,
      participantId,
      livekitIdentity: participant.identity,
      displayName: participant.name || participant.identity,
      role,
    };
  }

  private toTrackRef(
    publication: RemoteTrackPublication,
    participant: RemoteParticipant,
    sidOverride?: string,
  ): TrackRef | null {
    const kind =
      publication.kind === TrackKind.KIND_AUDIO
        ? 'audio'
        : publication.kind === TrackKind.KIND_VIDEO
          ? 'video'
          : null;
    if (!kind) return null;
    return {
      meetingId: this.meetingId,
      participantId: this.toParticipantRef(participant).participantId,
      trackSid: sidOverride ?? publication.sid ?? 'unknown',
      kind,
      source: mapSource(publication.source),
      mimeType: publication.mimeType,
    };
  }

  private dispatchFrame(envelope: { type: 'audio'; frame: AudioFrame } | { type: 'video'; frame: VideoFrame }): void {
    for (const pipeline of this.pipelines) {
      pipeline.push(envelope);
    }
  }

  private dispatchEvent(invoke: (consumer: MediaConsumer) => void | Promise<void>): void {
    for (const pipeline of this.pipelines) {
      pipeline.push({ type: 'event', invoke });
    }
  }
}

function mapSource(source: SdkTrackSource | undefined): TrackSource {
  switch (source) {
    case SdkTrackSource.SOURCE_CAMERA:
      return 'camera';
    case SdkTrackSource.SOURCE_MICROPHONE:
      return 'microphone';
    case SdkTrackSource.SOURCE_SCREENSHARE:
      return 'screen_share';
    case SdkTrackSource.SOURCE_SCREENSHARE_AUDIO:
      return 'screen_share_audio';
    default:
      return 'unknown';
  }
}
