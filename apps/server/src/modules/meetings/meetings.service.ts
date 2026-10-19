import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JoinRequest, Meeting, Participant, Prisma } from '@prisma/client';
import type {
  JoinRequestDto,
  JoinRequestStatus,
  MeetingPublicInfo,
  MeetingStatus,
  MeetingSummary,
  ParticipantDto,
  ParticipantRole,
  ParticipantState,
} from '@requimeet/contracts';
import { GuestTokenService } from '../identity/guest-token.service';
import { PrismaService } from '../../prisma/prisma.service';
import { generateMeetingCode } from './meeting-code';
import {
  CreateJoinRequestDto,
  CreateMeetingDto,
} from './dto/meetings.dto';
import { DOMAIN_EVENTS } from './meetings.events';

const GUEST_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface MeetingCreated extends MeetingSummary {
  url: string;
}

export interface JoinRequestCreated {
  request: JoinRequestDto;
  guestToken: string;
}

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestTokens: GuestTokenService,
    private readonly events: EventEmitter2,
  ) {}

  async create(hostUserId: string, dto: CreateMeetingDto): Promise<MeetingCreated> {
    const meeting = await this.createWithUniqueCode(hostUserId, dto.title);
    return { ...this.toSummary(meeting), url: `/m/${meeting.code}` };
  }

  async start(hostUserId: string, code: string): Promise<MeetingSummary> {
    const meeting = await this.getOwnedMeeting(hostUserId, code);
    if (meeting.status === 'ended') {
      throw new ConflictException('meeting already ended');
    }
    if (meeting.status === 'created') {
      const updated = await this.prisma.meeting.update({
        where: { id: meeting.id },
        data: { status: 'active', startedAt: new Date() },
      });
      await this.ensureHostParticipant(updated);
      this.logger.log(`reunion ${updated.code} iniciada`);
      this.events.emit(DOMAIN_EVENTS.meetingStarted, {
        meetingId: updated.id,
        code: updated.code,
        hostId: updated.hostId,
        status: 'active',
      });
      return this.toSummary(updated);
    }
    await this.ensureHostParticipant(meeting);
    return this.toSummary(meeting);
  }

  async end(hostUserId: string, code: string): Promise<MeetingSummary> {
    const meeting = await this.getOwnedMeeting(hostUserId, code);
    if (meeting.status === 'ended') {
      return this.toSummary(meeting);
    }
    const updated = await this.prisma.meeting.update({
      where: { id: meeting.id },
      data: { status: 'ended', endedAt: new Date() },
    });
    await this.events.emitAsync('meeting.closing', { meetingId: updated.id, code: updated.code, hostId: updated.hostId, status: 'ended' });
    this.logger.log(`reunion ${updated.code} finalizada`);
    this.events.emit(DOMAIN_EVENTS.meetingEnded, {
      meetingId: updated.id,
      code: updated.code,
      hostId: updated.hostId,
      status: 'ended',
    });
    return this.toSummary(updated);
  }

  async publicInfo(code: string): Promise<MeetingPublicInfo> {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    return {
      code: meeting.code,
      title: meeting.title,
      status: meeting.status as MeetingStatus,
      acceptingRequests: meeting.status === 'active',
    };
  }

  async createJoinRequest(
    code: string,
    dto: CreateJoinRequestDto,
    guestSessionId: string | null,
  ): Promise<JoinRequestCreated> {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    if (meeting.status === 'ended') {
      throw new ConflictException('meeting already ended');
    }
    if (meeting.status === 'created') {
      throw new ConflictException('meeting not started yet');
    }

    if (guestSessionId) {
      const kicked = await this.prisma.participant.findFirst({
        where: { meetingId: meeting.id, guestSessionId, state: 'kicked' },
      });
      if (kicked) {
        throw new ForbiddenException('guest was kicked from this meeting');
      }
      const latest = await this.prisma.joinRequest.findFirst({
        where: { meetingId: meeting.id, guestSessionId },
        orderBy: { createdAt: 'desc' },
      });
      if (latest && (latest.status === 'pending' || latest.status === 'accepted')) {
        return {
          request: this.toJoinRequestDto(latest),
          guestToken: this.guestTokens.issue(guestSessionId, code),
        };
      }
      const request = await this.prisma.joinRequest.create({
        data: {
          meetingId: meeting.id,
          guestSessionId,
          displayName: dto.displayName,
        },
      });
      this.emitJoinRequestCreated(meeting, request);
      return {
        request: this.toJoinRequestDto(request),
        guestToken: this.guestTokens.issue(guestSessionId, code),
      };
    }

    const [request, session] = await this.prisma.$transaction(async (tx) => {
      const guestSession = await tx.guestSession.create({
        data: {
          displayName: dto.displayName,
          expiresAt: new Date(Date.now() + GUEST_SESSION_TTL_MS),
        },
      });
      const created = await tx.joinRequest.create({
        data: {
          meetingId: meeting.id,
          guestSessionId: guestSession.id,
          displayName: dto.displayName,
        },
      });
      return [created, guestSession];
    });
    this.emitJoinRequestCreated(meeting, request);
    return {
      request: this.toJoinRequestDto(request),
      guestToken: this.guestTokens.issue(session.id, code),
    };
  }

  async cancelJoinRequest(
    guestSessionId: string,
    code: string,
  ): Promise<{ cancelled: boolean }> {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    const result = await this.prisma.joinRequest.updateMany({
      where: { meetingId: meeting.id, guestSessionId, status: 'pending' },
      data: { status: 'cancelled', decidedAt: new Date() },
    });
    return { cancelled: result.count > 0 };
  }

  async listJoinRequests(
    hostUserId: string,
    code: string,
    status?: JoinRequestStatus,
  ): Promise<JoinRequestDto[]> {
    const meeting = await this.getOwnedMeeting(hostUserId, code);
    const requests = await this.prisma.joinRequest.findMany({
      where: { meetingId: meeting.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return requests.map((r) => this.toJoinRequestDto(r));
  }

  async decideJoinRequest(
    hostUserId: string,
    code: string,
    requestId: string,
    decision: 'accepted' | 'rejected',
  ): Promise<JoinRequestDto> {
    const meeting = await this.getOwnedMeeting(hostUserId, code);
    const request = await this.prisma.joinRequest.findFirst({
      where: { id: requestId, meetingId: meeting.id },
    });
    if (!request) {
      throw new NotFoundException('join request not found');
    }

    if (decision === 'accepted') {
      if (meeting.status !== 'active') {
        throw new ConflictException('meeting is not active');
      }
      const kicked = await this.prisma.participant.findFirst({
        where: {
          meetingId: meeting.id,
          guestSessionId: request.guestSessionId,
          state: 'kicked',
        },
      });
      if (kicked) {
        throw new ForbiddenException('guest was kicked from this meeting');
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.joinRequest.updateMany({
        where: { id: request.id, status: 'pending' },
        data: { status: decision, decidedAt: new Date(), decidedById: hostUserId },
      });
      if (result.count === 0) {
        if (decision === 'accepted' && request.status === 'accepted') {
          await this.admitGuestParticipant(tx, meeting.id, request);
        }
        return null;
      }
      if (decision === 'accepted') {
        await this.admitGuestParticipant(tx, meeting.id, request);
      }
      return tx.joinRequest.findUniqueOrThrow({ where: { id: request.id } });
    });

    if (!updated) {
      return this.toJoinRequestDto(request);
    }
    this.logger.log(`reunion ${meeting.code}: solicitud ${updated.id} -> ${updated.status}`);
    this.events.emit(DOMAIN_EVENTS.joinRequestDecided, {
      meetingId: meeting.id,
      meetingCode: meeting.code,
      requestId: updated.id,
      guestSessionId: updated.guestSessionId,
      status: updated.status,
    });
    return this.toJoinRequestDto(updated);
  }

  async leaveByHost(hostUserId: string, code: string): Promise<ParticipantDto> {
    const meeting = await this.getMeetingOr404(code);
    const participant = await this.prisma.participant.findFirst({
      where: { meetingId: meeting.id, hostUserId },
    });
    return this.markLeft(participant);
  }

  async leaveByGuest(
    guestSessionId: string,
    code: string,
  ): Promise<ParticipantDto> {
    const meeting = await this.getMeetingOr404(code);
    const participant = await this.prisma.participant.findFirst({
      where: { meetingId: meeting.id, guestSessionId },
    });
    return this.markLeft(participant);
  }

  private async markLeft(
    participant: Participant | null,
  ): Promise<ParticipantDto> {
    if (!participant) {
      throw new NotFoundException('participant not found');
    }
    if (participant.state !== 'admitted') {
      return this.toParticipantDto(participant);
    }
    const updated = await this.prisma.participant.update({
      where: { id: participant.id },
      data: { state: 'left', leftAt: new Date() },
    });
    return this.toParticipantDto(updated);
  }

  private async admitGuestParticipant(
    tx: Prisma.TransactionClient,
    meetingId: string,
    request: JoinRequest,
  ): Promise<void> {
    const existing = await tx.participant.findFirst({
      where: { meetingId, guestSessionId: request.guestSessionId },
    });
    if (!existing) {
      await tx.participant.create({
        data: {
          meetingId,
          guestSessionId: request.guestSessionId,
          displayName: request.displayName,
          role: 'participant',
        },
      });
      return;
    }
    if (existing.state === 'kicked') {
      throw new ForbiddenException('guest was kicked from this meeting');
    }
    if (existing.state === 'left') {
      await tx.participant.update({
        where: { id: existing.id },
        data: { state: 'admitted', leftAt: null },
      });
    }
  }

  private async ensureHostParticipant(meeting: Meeting): Promise<void> {
    const host = await this.prisma.hostUser.findUniqueOrThrow({
      where: { id: meeting.hostId },
    });
    const existing = await this.prisma.participant.findFirst({
      where: { meetingId: meeting.id, hostUserId: meeting.hostId },
    });
    if (!existing) {
      await this.prisma.participant.create({
        data: {
          meetingId: meeting.id,
          hostUserId: meeting.hostId,
          displayName: host.displayName,
          role: 'host',
        },
      });
      return;
    }
    if (existing.state !== 'admitted') {
      await this.prisma.participant.update({
        where: { id: existing.id },
        data: { state: 'admitted', leftAt: null },
      });
    }
  }

  private async createWithUniqueCode(
    hostUserId: string,
    title: string,
  ): Promise<Meeting> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.meeting.create({
          data: { code: generateMeetingCode(), title, hostId: hostUserId },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('could not allocate meeting code');
  }

  private async getMeetingOr404(code: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) {
      throw new NotFoundException('meeting not found');
    }
    return meeting;
  }

  private async getOwnedMeeting(
    hostUserId: string,
    code: string,
  ): Promise<Meeting> {
    const meeting = await this.getMeetingOr404(code);
    if (meeting.hostId !== hostUserId) {
      throw new ForbiddenException('not the meeting host');
    }
    return meeting;
  }

  private emitJoinRequestCreated(meeting: Meeting, request: JoinRequest): void {
    this.events.emit(DOMAIN_EVENTS.joinRequestCreated, {
      meetingId: meeting.id,
      meetingCode: meeting.code,
      requestId: request.id,
      guestSessionId: request.guestSessionId,
      displayName: request.displayName,
    });
  }

  private toSummary(meeting: Meeting): MeetingSummary {
    return {
      id: meeting.id,
      code: meeting.code,
      title: meeting.title,
      status: meeting.status as MeetingStatus,
      createdAt: meeting.createdAt.toISOString(),
      startedAt: meeting.startedAt?.toISOString() ?? null,
      endedAt: meeting.endedAt?.toISOString() ?? null,
    };
  }

  private toJoinRequestDto(request: JoinRequest): JoinRequestDto {
    return {
      id: request.id,
      displayName: request.displayName,
      status: request.status as JoinRequestStatus,
      createdAt: request.createdAt.toISOString(),
    };
  }

  private toParticipantDto(participant: Participant): ParticipantDto {
    return {
      id: participant.id,
      displayName: participant.displayName,
      role: participant.role as ParticipantRole,
      state: participant.state as ParticipantState,
      joinedAt: participant.joinedAt.toISOString(),
    };
  }
}
