ALTER TABLE "Question" ADD COLUMN "askedAt" TIMESTAMP(3), ADD COLUMN "answerSuggestion" JSONB;
UPDATE "Question" SET "askedAt" = CURRENT_TIMESTAMP WHERE "status" = 'ASKED';
