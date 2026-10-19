-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('PENDING', 'CORRECTED', 'APPROVED');

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "participantId" TEXT,
    "trackSid" TEXT,
    "text" TEXT NOT NULL,
    "startMs" DOUBLE PRECISION,
    "endMs" DOUBLE PRECISION,
    "createdAtMs" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "transcriptSegmentId" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_resultId_key" ON "TranscriptSegment"("resultId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_meetingId_createdAt_idx" ON "TranscriptSegment"("meetingId", "createdAt");

-- CreateIndex
CREATE INDEX "Requirement_meetingId_status_idx" ON "Requirement"("meetingId", "status");

-- CreateIndex
CREATE INDEX "Requirement_transcriptSegmentId_idx" ON "Requirement"("transcriptSegmentId");

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_transcriptSegmentId_fkey" FOREIGN KEY ("transcriptSegmentId") REFERENCES "TranscriptSegment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
