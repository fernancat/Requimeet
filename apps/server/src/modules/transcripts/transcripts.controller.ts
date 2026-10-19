import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { TranscriptsService } from './transcripts.service';
@Controller('meetings/:code/transcripts')
export class TranscriptsController {
  constructor(
    private readonly service: TranscriptsService,
    private readonly callers: CallerResolver,
  ) {}
  @Get() list(
    @Param('code') code: string,
    @Req() req: Request,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.list(code, this.callers.resolve(req, code), cursor);
  }
  @Patch(':id') edit(
    @Param('code') code: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: { text: string; version: number },
  ) {
    return this.service.edit(code, id, this.callers.resolve(req, code), body);
  }
}
