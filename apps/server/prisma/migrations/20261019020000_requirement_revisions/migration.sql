ALTER TABLE "Requirement" ALTER COLUMN "transcriptSegmentId" DROP NOT NULL;
ALTER TABLE "Requirement" ADD COLUMN "sourceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "discarded" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]';
UPDATE "Requirement" SET "sourceIds" = ARRAY["transcriptSegmentId"] WHERE "transcriptSegmentId" IS NOT NULL;
