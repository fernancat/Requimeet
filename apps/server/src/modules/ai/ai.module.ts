import { ConversationPlanService } from './conversation-plan.service';
import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { OpenRouterService } from './openrouter.service';
@Module({
  imports: [MeetingsModule],
  providers: [ConversationPlanService, AiService, OpenRouterService],
  controllers: [AiController],
  exports: [ConversationPlanService, AiService, OpenRouterService],
})
export class AiModule {}
