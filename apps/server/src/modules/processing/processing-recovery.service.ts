import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RoomServiceClient, TrackType } from 'livekit-server-sdk';
import type { ProcessingSessionInfo } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcessingOrchestrator } from './processing.orchestrator';

/** A connected SDK can retain stale participants after a signaling interruption. */
export function missingAudio(expected: string[], actual: ProcessingSessionInfo | undefined): boolean {
  return !actual || actual.connectionState === 'disconnected' || expected.some(sid => !actual.audioTrackSids?.includes(sid));
}

@Injectable()
export class ProcessingRecoveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private misses = new Map<string, number>();
  private readonly logger = new Logger(ProcessingRecoveryService.name);
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly orchestrator: ProcessingOrchestrator) {}
  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || !this.config.get('LIVEKIT_API_KEY') || !this.config.get('INTERNAL_SHARED_SECRET')) return;
    this.timer = setInterval(() => { void this.check(); }, 10000);
    this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); }
  async check() {
    if (this.busy) return;
    this.busy = true;
    try {
      const client = new RoomServiceClient(this.config.get<string>('LIVEKIT_URL')!, this.config.get<string>('LIVEKIT_API_KEY'), this.config.get<string>('LIVEKIT_API_SECRET'), { requestTimeout: 5 });
      const rooms = await client.listRooms();
      const base = this.config.get('PROCESSOR_INTERNAL_URL', 'http://localhost:4100');
      const headers = { 'x-internal-secret': this.config.get<string>('INTERNAL_SHARED_SECRET')! };
      const response = await fetch(`${base}/sessions`, { headers, signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error(`processor status ${response.status}`);
      const sessions = await response.json() as ProcessingSessionInfo[];
      const activeIds = new Set<string>();
      for (const room of rooms) {
        const meeting = await this.prisma.meeting.findUnique({ where: { code: room.name } });
        if (!meeting || meeting.status !== 'active') continue;
        activeIds.add(meeting.id);
        const participants = await client.listParticipants(room.name);
        const expected = participants.flatMap(p => p.tracks.filter(t => t.type === TrackType.AUDIO && !t.muted).map(t => t.sid));
        if (!expected.length) { this.misses.delete(meeting.id); continue; }
        const session = sessions.find(s => s.meetingId === meeting.id);
        const missed = missingAudio(expected, session) ? (this.misses.get(meeting.id) ?? 0) + 1 : 0;
        this.misses.set(meeting.id, missed);
        // Two samples avoid restarting a track while its normal subscription is negotiating.
        if (missed < 2) continue;
        const current = await this.prisma.meeting.findUnique({ where: { id: meeting.id } });
        if (current?.status !== 'active') continue;
        this.logger.warn(`Recuperando pistas ausentes en ${meeting.code}`);
        await this.orchestrator.onMeetingStarted({ meetingId: meeting.id, code: meeting.code, hostId: meeting.hostId, status: 'active', startedAtMs: meeting.startedAt?.getTime() }, true);
        this.misses.delete(meeting.id);
      }
      for (const id of this.misses.keys()) if (!activeIds.has(id)) this.misses.delete(id);
    } catch (error) { this.logger.warn(`Comprobación de procesamiento: ${error instanceof Error ? error.message : 'falló'}`); }
    finally { this.busy = false; }
  }
}
