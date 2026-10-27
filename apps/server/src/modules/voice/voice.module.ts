import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { AiModule } from '../ai/ai.module';
import { VoiceService } from './voice.service';
import { VoiceController } from './voice.controller';
import { ElevenLabsService } from './elevenlabs.service';
@Module({ imports: [MeetingsModule, AiModule], providers: [VoiceService, ElevenLabsService], controllers: [VoiceController] })
export class VoiceModule {}
