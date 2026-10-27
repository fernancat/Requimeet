import { Body, Controller, Get, Header, Param, Patch, Post, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { VoiceService } from './voice.service';
@Controller('meetings/:code/voice')
export class VoiceController {
  constructor(private readonly voice: VoiceService, private readonly callers: CallerResolver) {}
  @Get() state(@Param('code') code: string, @Req() req: Request) { return this.voice.state(code, this.callers.resolve(req, code)); }
  @Patch() configure(@Param('code') code: string, @Req() req: Request, @Body() body: unknown) { return this.voice.configure(code, this.callers.resolve(req, code), body); }
  @Post('question') question(@Param('code') code: string, @Req() req: Request, @Body() body: unknown) { return this.voice.question(code, this.callers.resolve(req, code), body); }
  @Get(':id/audio') @Header('Cache-Control', 'no-store')
  async audio(@Param('code') code: string, @Param('id') id: string, @Req() req: Request) {
    return new StreamableFile(await this.voice.audio(code, this.callers.resolve(req, code), id), { type: 'audio/mpeg' });
  }
}
