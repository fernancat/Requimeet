import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { AiService } from './ai.service';
@Controller('meetings/:code/analysis')
export class AiController {
  constructor(private readonly ai: AiService, private readonly callers: CallerResolver) {}
  @Get() list(@Param('code') code: string, @Req() req: Request) { return this.ai.list(code, this.callers.resolve(req, code)); }
  @Post() run(@Param('code') code: string, @Req() req: Request) { return this.ai.analyze(code, this.callers.resolve(req, code)); }
}
