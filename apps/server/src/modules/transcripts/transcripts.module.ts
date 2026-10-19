import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';
@Module({
  imports: [MeetingsModule],
  controllers: [TranscriptsController],
  providers: [TranscriptsService],
  exports: [TranscriptsService],
})
export class TranscriptsModule {}
