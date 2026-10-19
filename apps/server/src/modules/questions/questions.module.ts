import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { QuestionsService } from './questions.service';
import { QuestionsController } from './questions.controller';
@Module({ imports: [MeetingsModule], providers: [QuestionsService], controllers: [QuestionsController] })
export class QuestionsModule {}
