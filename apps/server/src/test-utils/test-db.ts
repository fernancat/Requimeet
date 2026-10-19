import { PrismaClient } from '@prisma/client';

export const TEST_DATABASE_URL =
  'postgresql://requimeet:requimeet@localhost:55440/requimeet_test';

export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  });
}

export async function cleanDb(prisma: PrismaClient): Promise<void> {
  await prisma.aiJob.deleteMany();
  await prisma.question.deleteMany();
  await prisma.requirement.deleteMany();
  await prisma.transcriptSegment.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.participant.deleteMany();
  await prisma.joinRequest.deleteMany();
  await prisma.guestSession.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.hostUser.deleteMany();
}
