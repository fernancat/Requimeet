import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Req,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { ArtifactsService } from './artifacts.service';
@Controller('meetings/:code/artifacts/:kind')
export class ArtifactsController {
  constructor(
    private readonly service: ArtifactsService,
    private readonly callers: CallerResolver,
  ) {}
  @Get(':id/export/:format') async export(
    @Param('code') code: string,
    @Param('id') id: string,
    @Param('format') format: string,
    @Query('version') version: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const buffer = await this.service.export(
      code,
      id,
      this.callers.resolve(req, code),
      format,
      Number(version),
    );
    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="requerimientos-v${Number(version)}.${format}"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }
  @Get() list(
    @Param('code') code: string,
    @Param('kind') kind: string,
    @Req() req: Request,
  ) {
    return this.service.list(code, kind, this.callers.resolve(req, code));
  }
  @Post() generate(
    @Param('code') code: string,
    @Param('kind') kind: string,
    @Req() req: Request,
  ) {
    return this.service.generate(code, kind, this.callers.resolve(req, code));
  }
  @Patch(':id') edit(
    @Param('code') code: string,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: { version: number; content?: unknown; action?: string },
  ) {
    return this.service.edit(
      code,
      kind,
      id,
      this.callers.resolve(req, code),
      body,
    );
  }
}
