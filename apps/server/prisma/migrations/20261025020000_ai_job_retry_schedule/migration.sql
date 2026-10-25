ALTER TABLE "AiJob" ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "AiJob_status_nextAttemptAt_idx" ON "AiJob"("status", "nextAttemptAt");
