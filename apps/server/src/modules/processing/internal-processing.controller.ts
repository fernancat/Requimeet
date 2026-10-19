import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { ProcessingResult } from '@requimeet/contracts';
import { RT_EVENTS } from '@requimeet/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEmitter } from '../realtime/realtime.emitter';
import { InternalSecretGuard } from './internal-secret.guard';
import { TranscriptsService } from '../transcripts/transcripts.service';

const RESULT_KINDS = ['demo', 'transcript-partial', 'transcript-final', 'analysis'];

@Controller('internal/processing')
export class InternalProcessingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: RealtimeEmitter,
    private readonly transcripts: TranscriptsService,
  ) {}

  /** Recibe resultados del processor y los retransmite a la reunion. */
  @Post('results')
  @UseGuards(InternalSecretGuard)
  async receive(@Body() body: ProcessingResult) {
    if (
      !body ||
      typeof body.resultId !== 'string' ||
      typeof body.meetingId !== 'string' ||
      !RESULT_KINDS.includes(body.kind) ||
      typeof body.isFinal !== 'boolean' ||
      typeof body.createdAtMs !== 'number' ||
      typeof body.payload !== 'object' ||
      body.payload === null
    ) {
      return { received: false, error: 'invalid ProcessingResult shape' };
    }
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: body.meetingId },
    });
    if (!meeting || (meeting.status === 'ended' && (!meeting.endedAt || Date.now() - meeting.endedAt.getTime() > 30000))) {
      return { received: true, discarded: true };
    }

    const saved = await this.transcripts.save(body);
    if (saved && (saved.revision !== (body.revision ?? 1) || saved.edited)) return { received: true }; 
    
    this.emitter.toMeeting(meeting.code, RT_EVENTS.serverProcessingResult, body);
    return { received: true };

  }
}
