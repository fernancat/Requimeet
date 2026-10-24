/**
 * Contrato de procesamiento multimedia (punto de extension para
 * transcripcion, analisis y generacion de documentos).
 *
 * Productor: apps/processor (proceso separado, mismo repo) que se une a la
 * sala de LiveKit como participante oculto y suscribe pistas con el SDK de
 * servidor (@livekit/rtc-node). Los modulos de admision, chat y controles no
 * participan en este flujo.
 *
 * Consumidor: cualquier implementacion de MediaConsumer registrada en el
 * processor. El consumidor demo (DemoConsumer) es la referencia funcional.
 *
 * Notas de diseno:
 * - Audio por defecto; video opcional (PROCESSOR_ENABLE_VIDEO).
 * - `mediaTimeMs` es el tiempo del medio (RTP); `receivedAtMs` es la hora de
 *   recepcion en el servidor. NO se garantiza sincronizacion exacta entre
 *   participantes; para alinear pistas hay que implementar sincronizacion
 *   aparte.
 * - Los consumidores deben ser mas rapidos que el tiempo real o descartar.
 *   El processor aplica buffers limitados con politica drop-oldest.
 */

export type MediaKind = 'audio' | 'video';

/** Fuente de la pista segun LiveKit (camara, microfono, pantalla). */
export type TrackSource =
  | 'camera'
  | 'microphone'
  | 'screen_share'
  | 'screen_share_audio'
  | 'unknown';

export interface ParticipantRef {
  meetingId: string;
  /** Identidad interna estable (Participant.id de la app). */
  participantId: string;
  /** Identidad usada en LiveKit (no es un permiso, solo correlacion). */
  livekitIdentity: string;
  displayName: string;
  role: 'host' | 'participant';
}

export interface TrackRef {
  meetingId: string;
  participantId: string;
  /** SID de la pista en LiveKit, estable durante la publicacion. */
  trackSid: string;
  kind: MediaKind;
  source: TrackSource;
  /** MimeType declarado por LiveKit (p.ej. audio/opus, video/vp8). */
  mimeType?: string;
}

/** Audio PCM crudo, listo para un STT como Deepgram. */
export interface AudioFrame {
  track: TrackRef;
  /** PCM little-endian con signo. */
  format: 'pcm16';
  sampleRateHz: number;
  channels: number;
  /** Duracion del frame en ms (normalmente 10 o 20). */
  durationMs: number;
  /** Tiempo del medio en ms desde el inicio de la pista (RTP-derived). */
  mediaTimeMs: number;
  /** Hora de recepcion en el servidor (epoch ms). */
  receivedAtMs: number;
  samples: Int16Array;
}

export interface VideoFrame {
  track: TrackRef;
  width: number;
  height: number;
  /** Formato del buffer, p.ej. 'i420' (YUV) segun el SDK. */
  format: string;
  mediaTimeMs: number;
  receivedAtMs: number;
  /** Plano(s) de datos crudos; interpretar segun `format`. */
  data: Uint8Array;
}

/** Eventos del ciclo de vida que recibe un consumidor. */
export interface MediaConsumer {
  onSessionStart?(session: { meetingId: string; startedAtMs: number }): void | Promise<void>;
  onSessionEnd?(session: { meetingId: string; endedAtMs: number; reason: string }): void | Promise<void>;
  onParticipantConnected?(p: ParticipantRef): void | Promise<void>;
  onParticipantDisconnected?(p: ParticipantRef): void | Promise<void>;
  onTrackPublished?(track: TrackRef): void | Promise<void>;
  onTrackMuted?(track: TrackRef): void | Promise<void>;
  onTrackUnpublished?(track: TrackRef): void | Promise<void>;
  onAudioFrame?(frame: AudioFrame): void | Promise<void>;
  onVideoFrame?(frame: VideoFrame): void | Promise<void>;
}

/**
 * Resultado publicado hacia la aplicacion. El processor lo envia al backend
 * (POST /internal/processing/results) y el backend lo retransmite por el
 * canal de tiempo real a los participantes admitidos.
 *
 * `resultId` + `replacesResultId` permiten que una transcripcion futura
 * emita parciales y luego los corrija sin duplicar la frase.
 */
export interface ProcessingResult {
  resultId: string;
  revision?: number;
  /** Si existe, este resultado corrige/reemplaza a uno anterior. */
  replacesResultId?: string;
  meetingId: string;
  participantId?: string;
  trackSid?: string;
  /** 'demo' = demostracion, no es una transcripcion real. */
  kind: 'demo' | 'transcript-partial' | 'transcript-final' | 'analysis';
  /** true si el resultado es definitivo y no se corregira. */
  isFinal: boolean;
  createdAtMs: number;
  payload: Record<string, unknown>;
}

/** Peticion del backend al processor para iniciar procesamiento. */
export interface StartProcessingRequest {
  /** Recuperación explícita tras contrastar con el SFU. */
  restart?: boolean;
  startedAtMs?: number;
  meetingId: string;
  /** Nombre de la sala en LiveKit (= meeting code). */
  roomName: string;
  livekitUrl: string;
  /** Token del participante oculto del processor (canSubscribe, sin publicar). */
  processorToken: string;
  /** Suscribir video ademas de audio. */
  enableVideo: boolean;
}

export interface ProcessingSessionInfo {
  meetingId: string;
  roomName: string;
  startedAtMs: number;
  subscribedTracks: number;
  audioTrackSids?: string[];
  /** Estado de conexion del processor a LiveKit. */
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
}
