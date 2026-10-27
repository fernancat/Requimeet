import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';

@Injectable()
export class ElevenLabsService {
  readonly model = 'eleven_v4_turbo';
  constructor(private readonly config: ConfigService) {}
  enabled() { return Boolean(this.config.get<string>('ELEVENLABS_API_KEY')); }
  synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
    const key = this.config.get<string>('ELEVENLABS_API_KEY');
    if (!key) throw new ServiceUnavailableException('La voz de Brody no está configurada.');
    const voice = this.config.get<string>('ELEVENLABS_VOICE_ID') || '21m00Tcm4TlvDq8ikWAM';
    return new Promise((resolve, reject) => {
      // v4 Turbo uses Text to Dialogue, not the legacy TTS WebSocket protocol.
      const ws = new WebSocket(`wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=${this.model}&output_format=mp3_44100_128`, {
        headers: { 'xi-api-key': key }, handshakeTimeout: 8000, maxPayload: 2 * 1024 * 1024,
      });
      const chunks: Buffer[] = [];
      let bytes = 0, settled = false;
      const finish = (error?: string) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        ws.terminate();
        if (error || !bytes) reject(new ServiceUnavailableException(error || 'ElevenLabs no devolvió audio.'));
        else resolve(Buffer.concat(chunks));
      };
      const abort = () => finish('Reproducción cancelada.');
      const timer = setTimeout(() => finish('ElevenLabs tardó demasiado. Puedes volver a intentarlo.'), 18000);
      ws.on('error', () => finish('No se pudo conectar con ElevenLabs.'));
      ws.on('unexpected-response', (_req, res) => { res.resume(); finish(res.statusCode === 401 ? 'ElevenLabs rechazó la clave o sus permisos de voz.' : res.statusCode === 429 ? 'ElevenLabs alcanzó el límite de solicitudes.' : 'ElevenLabs no pudo generar la voz.'); });
      ws.on('close', () => { if (!settled) finish('ElevenLabs cerró la conexión antes de completar el audio.'); });
      ws.on('open', () => {
        ws.send(JSON.stringify({ voices: [voice] }));
        ws.send(JSON.stringify({ inputs: [{ text, voice_id: voice }] }));
        ws.send(JSON.stringify({ close_socket: true }));
      });
      ws.on('message', raw => {
        try {
          const message = JSON.parse(raw.toString());
          if (message.error || message.type === 'error') return finish('ElevenLabs rechazó la generación de voz. Revisa permisos, créditos y voz seleccionada.');
          if (message.audio) {
            if (typeof message.audio !== 'string') return finish('Audio inválido de ElevenLabs.');
            const chunk = Buffer.from(message.audio, 'base64'); bytes += chunk.length;
            if (bytes > 2 * 1024 * 1024) return finish('La respuesta de voz excedió el límite.');
            chunks.push(chunk);
          }
          if (message.is_final) finish();
        } catch { finish('Respuesta inválida de ElevenLabs.'); }
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}
