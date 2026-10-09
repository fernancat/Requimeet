import { Controller, Get, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { ChatService } from './chat.service';

@Controller('meetings')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly callerResolver: CallerResolver,
  ) {}

  @Get(':code/messages')
  history(@Param('code') code: string, @Req() req: Request) {
    return this.chat.history(code, this.callerResolver.resolve(req, code));
  }
}
