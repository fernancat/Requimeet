import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from '../identity/auth.service';
import { GuestPrincipal, HostPrincipal } from '../identity/auth.types';
import { GuestAuthGuard } from '../identity/guest-auth.guard';
import { GuestTokenService } from '../identity/guest-token.service';
import { HostAuthGuard } from '../identity/host-auth.guard';
import {
  CreateJoinRequestDto,
  CreateMeetingDto,
  ListJoinRequestsQuery,
} from './dto/meetings.dto';
import { MeetingsService } from './meetings.service';

type HostRequest = Request & { user: HostPrincipal };
type GuestRequest = Request & { guest: GuestPrincipal };

@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly authService: AuthService,
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
    const token = this.bearerToken(req);
    if (!token) {
      throw new UnauthorizedException('missing bearer token');
    }
    try {
      const host = this.authService.verifyHostToken(token);
      return this.meetings.leaveByHost(host.sub, code);
    } catch {
      // no es token de host; se intenta como invitado
    }
    const guest = this.guestTokens.verify(token, code);
    return this.meetings.leaveByGuest(guest.sub, code);
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
