import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { CallerResolver } from '../meetings/caller-resolver';
import { RequirementsService } from './requirements.service';
import { UpdateRequirementDto } from './update-requirement.dto';

@Controller('meetings')
export class RequirementsController {
  constructor(
    private readonly requirements: RequirementsService,
    private readonly callerResolver: CallerResolver,
  ) {}

  @Get(':code/requirements')
  list(@Param('code') code: string, @Req() req: Request) {
    const caller = this.callerResolver.resolve(req, code);
    return this.requirements.list(code, caller);
  }

  @Post(':code/requirements')
  create(@Param('code') code: string, @Req() req: Request, @Body() body: { text: string; sourceIds?: string[] }) {
    return this.requirements.create(code, this.callerResolver.resolve(req, code), body);
  }

  @Patch(':code/requirements/:requirementId')
  update(
    @Param('code') code: string,
    @Param('requirementId') requirementId: string,
    @Req() req: Request,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    body: UpdateRequirementDto,
  ) {
    const caller = this.callerResolver.resolve(req, code);

    return this.requirements.update(
      code,
      requirementId,
      caller,
      body,
    );
  }
}