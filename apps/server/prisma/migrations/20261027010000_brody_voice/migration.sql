ALTER TABLE "Meeting" ADD COLUMN "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "voiceShared" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "voiceVersion" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "voiceSince" TIMESTAMP(3);
CREATE TABLE "BrodyUtterance" (
 "id" TEXT NOT NULL PRIMARY KEY, "meetingId" TEXT NOT NULL, "key" TEXT NOT NULL,
 "kind" TEXT NOT NULL, "text" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'generating',
 "error" TEXT, "audio" BYTEA, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BrodyUtterance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BrodyUtterance_meetingId_key_key" ON "BrodyUtterance"("meetingId", "key");
CREATE INDEX "BrodyUtterance_meetingId_createdAt_idx" ON "BrodyUtterance"("meetingId", "createdAt");
