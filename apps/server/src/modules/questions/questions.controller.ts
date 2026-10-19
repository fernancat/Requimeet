import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { QuestionsService } from './questions.service';
@Controller('meetings/:code/questions')
export class QuestionsController {
 constructor(private readonly service: QuestionsService, private readonly callers: CallerResolver) {}
 @Get() list(@Param('code') code: string, @Req() req: Request) { return this.service.list(code, this.callers.resolve(req, code)); }
 @Patch(':id') edit(@Param('code') code: string, @Param('id') id: string, @Req() req: Request, @Body() body: unknown) { return this.service.edit(code, id, this.callers.resolve(req, code), body); }
}
