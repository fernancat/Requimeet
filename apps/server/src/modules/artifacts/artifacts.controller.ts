import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { ArtifactsService } from './artifacts.service';
@Controller('meetings/:code/artifacts/:kind')
export class ArtifactsController {
 constructor(private readonly service: ArtifactsService, private readonly callers: CallerResolver) {}
 @Get() list(@Param('code') code: string, @Param('kind') kind: string, @Req() req: Request) { return this.service.list(code, kind, this.callers.resolve(req, code)); }
 @Post() generate(@Param('code') code: string, @Param('kind') kind: string, @Req() req: Request) { return this.service.generate(code, kind, this.callers.resolve(req, code)); }
 @Patch(':id') edit(@Param('code') code: string, @Param('kind') kind: string, @Param('id') id: string, @Req() req: Request, @Body() body: { version: number; content?: unknown; action?: string }) { return this.service.edit(code, kind, id, this.callers.resolve(req, code), body); }
}
