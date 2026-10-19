import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Caller } from './caller-resolver';

@Injectable()
export class MeetingAccessService {
  constructor(private readonly prisma: PrismaService) {}
  async require(code: string, caller: Caller, write = false) {
    const meeting = await this.prisma.meeting.findUnique({ where: { code } });
    if (!meeting) throw new NotFoundException('Reunión no encontrada');
    if (caller.kind === 'host' && caller.hostUserId === meeting.hostId)
      return meeting;
    if (write || meeting.status !== 'active')
      throw new ForbiddenException(
        'Solo el anfitrión puede administrar el levantamiento',
      );
    const participant = await this.prisma.participant.findFirst({
      where: {
        meetingId: meeting.id,
        state: 'admitted',
        ...(caller.kind === 'host'
          ? { hostUserId: caller.hostUserId }
          : { guestSessionId: caller.guestSessionId }),
      },
    });
    if (!participant)
      throw new ForbiddenException(
        'Acceso restringido a participantes admitidos',
      );
    return meeting;
  }
}
