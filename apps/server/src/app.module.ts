import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { ChatModule } from './modules/chat/chat.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    IdentityModule,
    MeetingsModule,
    ChatModule,
    RealtimeModule,
  ],
})
export class AppModule {}
