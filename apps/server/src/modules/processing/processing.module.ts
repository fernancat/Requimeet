import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { InternalProcessingController } from './internal-processing.controller';
import { InternalSecretGuard } from './internal-secret.guard';
import { ProcessingOrchestrator } from './processing.orchestrator';
import { RequirementsModule } from '../requirements/requirements.module';

@Module({
  imports: [RealtimeModule, RequirementsModule],
  controllers: [InternalProcessingController],
  providers: [ProcessingOrchestrator, InternalSecretGuard],
})
export class ProcessingModule {}
