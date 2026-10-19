import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { PrismaService } from '../../prisma/prisma.service';
import { RequirementsService } from './requirements.service';

async function main() {
  const prisma = new PrismaService();
  const service = new RequirementsService(prisma);

  const hostId = randomUUID();
  const meetingId = randomUUID();

  try {
    await prisma.hostUser.create({
      data: {
        id: hostId,
        email: `prueba-${hostId}@example.com`,
        passwordHash: 'prueba-sin-inicio-de-sesion',
        displayName: 'Prueba de requerimientos',
      },
    });

    const meeting = await prisma.meeting.create({
      data: {
        id: meetingId,
        code: randomUUID(),
        title: 'Prueba temporal',
        hostId,
      },
    });

    const participant = await prisma.participant.create({
      data: {
        meetingId,
        hostUserId: hostId,
        displayName: 'Anfitrión de prueba',
        role: 'host',
        state: 'admitted',
      },
    });

    const caller = {
      kind: 'host' as const,
      hostUserId: hostId,
    };

    const result = {
      resultId: randomUUID(),
      meetingId,
      participantId: participant.id,
      kind: 'transcript-final' as const,
      isFinal: true,
      createdAtMs: Date.now(),
      payload: {
        text: 'El sistema debe permitir registrar clientes.',
        startMs: 0,
        endMs: 3000,
      },
    };

    // Guarda el fragmento y extrae el requerimiento.
    await service.saveFinalTranscript(result);

    const requirement = await prisma.requirement.findFirstOrThrow({
      where: { meetingId },
      include: { transcriptSegment: true },
    });

    assert.equal(requirement.status, 'PENDING');
    assert.equal(
      requirement.transcriptSegment.resultId,
      result.resultId,
    );
    assert.equal(
      requirement.transcriptSegment.participantId,
      participant.id,
    );
    assert.equal(requirement.transcriptSegment.startMs, 0);
    assert.equal(requirement.transcriptSegment.endMs, 3000);

    // Consulta como participante admitido.
    const listed = await service.list(meeting.code, caller);

    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, requirement.id);
    assert.equal(
      listed[0].transcriptSegment.participant?.displayName,
      'Anfitrión de prueba',
    );

    // Editar el texto lo marca automáticamente como corregido.
    const corrected = await service.update(
      meeting.code,
      requirement.id,
      caller,
      {
        text: 'El sistema debe registrar clientes con nombre y correo.',
      },
    );

    assert.equal(corrected.status, 'CORRECTED');
    assert.equal(corrected.originalText, requirement.originalText);

    // Cambia a aprobado.
    const approved = await service.update(
      meeting.code,
      requirement.id,
      caller,
      { status: 'APPROVED' },
    );

    assert.equal(approved.status, 'APPROVED');

    // Cambia a pendiente.
    const pending = await service.update(
      meeting.code,
      requirement.id,
      caller,
      { status: 'PENDING' },
    );

    assert.equal(pending.status, 'PENDING');

    // Vuelve a corregido para comprobar el reintento.
    await service.update(
      meeting.code,
      requirement.id,
      caller,
      { status: 'CORRECTED' },
    );

    // El mismo resultado no debe duplicar ni sobrescribir.
    await service.saveFinalTranscript(result);

    const requirements = await prisma.requirement.findMany({
      where: { meetingId },
    });

    assert.equal(requirements.length, 1);
    assert.equal(requirements[0].status, 'CORRECTED');
    assert.equal(
      requirements[0].text,
      'El sistema debe registrar clientes con nombre y correo.',
    );
    assert.equal(
      requirements[0].originalText,
      requirement.originalText,
    );

    assert.equal(
      await prisma.transcriptSegment.count({
        where: { meetingId },
      }),
      1,
    );

    // Un resultado parcial no debe guardarse ni extraerse.
    const partial = await service.saveFinalTranscript({
      ...result,
      resultId: randomUUID(),
      kind: 'transcript-partial',
      isFinal: false,
    });

    assert.equal(partial, null);

    assert.equal(
      await prisma.transcriptSegment.count({
        where: { meetingId },
      }),
      1,
    );

    assert.equal(
      await prisma.requirement.count({
        where: { meetingId },
      }),
      1,
    );

    console.log(
      'PRUEBA CORRECTA: consulta, edición, estados, fuente vinculada, ' +
        'parciales ignorados y reintentos sin duplicados.',
    );
  } finally {
    // Elimina únicamente los datos creados por esta prueba.
    try {
      await prisma.requirement.deleteMany({
        where: { meetingId },
      });

      await prisma.transcriptSegment.deleteMany({
        where: { meetingId },
      });

      await prisma.participant.deleteMany({
        where: { meetingId },
      });

      await prisma.meeting.deleteMany({
        where: { id: meetingId },
      });

      await prisma.hostUser.deleteMany({
        where: { id: hostId },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});