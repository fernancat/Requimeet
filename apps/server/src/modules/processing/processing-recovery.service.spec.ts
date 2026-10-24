import { ConfigService } from '@nestjs/config';
import { missingAudio, ProcessingRecoveryService } from './processing-recovery.service';
import { RoomServiceClient, TrackType } from 'livekit-server-sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcessingOrchestrator } from './processing.orchestrator';

it('detecta pista nueva ausente aunque el SDK declare connected', () => {
  const session = { meetingId: 'm', roomName: 'r', startedAtMs: 1, subscribedTracks: 1, audioTrackSids: ['old'], connectionState: 'connected' as const };
  expect(missingAudio(['new'], session)).toBe(true);
  expect(missingAudio(['old'], session)).toBe(false);
});
it('recupera tras dos muestras, conserva el origen temporal y no toca una sesión sana', async () => {
  jest.spyOn(RoomServiceClient.prototype, 'listRooms').mockResolvedValue([{ name: 'ROOM' }] as never);
  jest.spyOn(RoomServiceClient.prototype, 'listParticipants').mockResolvedValue([{ tracks: [{ type: TrackType.AUDIO, sid: 'new', muted: false }] }] as never);
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => new Response(JSON.stringify([{ meetingId: 'm', connectionState: 'connected', audioTrackSids: ['old'] }])));
  const meeting = { id: 'm', code: 'ROOM', status: 'active', hostId: 'h', startedAt: new Date(1000) };
  const prisma = { meeting: { findUnique: jest.fn().mockResolvedValue(meeting) } };
  const restart = jest.fn();
  const service = new ProcessingRecoveryService(new ConfigService({ LIVEKIT_URL: 'https://example.test', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', INTERNAL_SHARED_SECRET: 's' }), prisma as unknown as PrismaService, { onMeetingStarted: restart } as unknown as ProcessingOrchestrator);
  try {
    await service.check(); expect(restart).not.toHaveBeenCalled();
    await service.check(); expect(restart).toHaveBeenCalledWith(expect.objectContaining({ meetingId: 'm', startedAtMs: 1000 }), true);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify([{ meetingId: 'm', connectionState: 'connected', audioTrackSids: ['new'] }])));
    await service.check(); await service.check(); expect(restart).toHaveBeenCalledTimes(1);
  } finally { jest.restoreAllMocks(); }
});
