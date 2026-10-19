import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { OpenRouterService } from './openrouter.service';
@Module({ imports: [MeetingsModule], providers: [AiService, OpenRouterService], controllers: [AiController], exports: [AiService, OpenRouterService] })
export class AiModule {}
