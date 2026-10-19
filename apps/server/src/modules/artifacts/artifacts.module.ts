import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { AiModule } from '../ai/ai.module';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
@Module({ imports: [MeetingsModule, AiModule], providers: [ArtifactsService], controllers: [ArtifactsController], exports: [ArtifactsService] })
export class ArtifactsModule {}
