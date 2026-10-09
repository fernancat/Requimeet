import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { GuestPrincipal, HostPrincipal } from '../identity/auth.types';
import { GuestAuthGuard } from '../identity/guest-auth.guard';
import { GuestTokenService } from '../identity/guest-token.service';
import { HostAuthGuard } from '../identity/host-auth.guard';
import { CallerResolver } from './caller-resolver';
import {
  CreateJoinRequestDto,
  CreateMeetingDto,
  ListJoinRequestsQuery,
} from './dto/meetings.dto';
import { MeetingParticipantsService } from './meeting-participants.service';
import { MeetingsService } from './meetings.service';

type HostRequest = Request & { user: HostPrincipal };
type GuestRequest = Request & { guest: GuestPrincipal };

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly participants: MeetingParticipantsService,
    private readonly callerResolver: CallerResolver,
    private readonly guestTokens: GuestTokenService,
  ) {}

  @Post()
  @UseGuards(HostAuthGuard)
  create(@Req() req: HostRequest, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(req.user.hostUserId, dto);
  }

  @Post(':code/start')
  @UseGuards(HostAuthGuard)
  start(@Req() req: HostRequest, @Param('code') code: string) {
    return this.meetings.start(req.user.hostUserId, code);
  }

  @Post(':code/end')
  @UseGuards(HostAuthGuard)
  end(@Req() req: HostRequest, @Param('code') code: string) {
    return this.meetings.end(req.user.hostUserId, code);
  }

  @Get(':code')
  publicInfo(@Param('code') code: string) {
    return this.meetings.publicInfo(code);
  }

  @Post(':code/join-requests')
  createJoinRequest(
    @Param('code') code: string,
    @Body() dto: CreateJoinRequestDto,
    @Req() req: Request,
  ) {
    return this.meetings.createJoinRequest(
      code,
      dto,
      this.tryGuestSessionId(req, code),
    );
  }

  @Delete(':code/join-requests')
  @UseGuards(GuestAuthGuard)
  cancelJoinRequest(@Req() req: GuestRequest) {
    return this.meetings.cancelJoinRequest(
      req.guest.guestSessionId,
      req.guest.meetingCode,
    );
  }

  @Get(':code/join-requests')
  @UseGuards(HostAuthGuard)
  listJoinRequests(
    @Req() req: HostRequest,
    @Param('code') code: string,
    @Query() query: ListJoinRequestsQuery,
  ) {
    return this.meetings.listJoinRequests(req.user.hostUserId, code, query.status);
  }

  @Post(':code/join-requests/:id/accept')
  @UseGuards(HostAuthGuard)
  accept(
    @Req() req: HostRequest,
    @Param('code') code: string,
    @Param('id') id: string,
  ) {
    return this.meetings.decideJoinRequest(req.user.hostUserId, code, id, 'accepted');
  }

  @Post(':code/join-requests/:id/reject')
  @UseGuards(HostAuthGuard)
  reject(
    @Req() req: HostRequest,
    @Param('code') code: string,
    @Param('id') id: string,
  ) {
    return this.meetings.decideJoinRequest(req.user.hostUserId, code, id, 'rejected');
  }

  @Post(':code/leave')
  leave(@Param('code') code: string, @Req() req: Request) {
    const caller = this.callerResolver.resolve(req, code);
    return caller.kind === 'host'
      ? this.meetings.leaveByHost(caller.hostUserId, code)
      : this.meetings.leaveByGuest(caller.guestSessionId, code);
  }

  @Post(':code/media-token')
  mediaToken(@Param('code') code: string, @Req() req: Request) {
    return this.participants.createMediaToken(
      this.callerResolver.resolve(req, code),
      code,
    );
  }

  @Post(':code/participants/:id/kick')
  @UseGuards(HostAuthGuard)
  kick(
    @Req() req: HostRequest,
    @Param('code') code: string,
    @Param('id') id: string,
  ) {
    return this.participants.kick(req.user.hostUserId, code, id);
  }

  @Post(':code/participants/:id/mute')
  @UseGuards(HostAuthGuard)
  mute(
    @Req() req: HostRequest,
    @Param('code') code: string,
    @Param('id') id: string,
  ) {
    return this.participants.mute(req.user.hostUserId, code, id);
  }

  private bearerToken(req: Request): string | null {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : null;
  }

  private tryGuestSessionId(req: Request, code: string): string | null {
    const token = this.bearerToken(req);
    if (!token) {
      return null;
    }
    try {
      return this.guestTokens.verify(token, code).sub;
    } catch {
      return null;
    }
  }
}
