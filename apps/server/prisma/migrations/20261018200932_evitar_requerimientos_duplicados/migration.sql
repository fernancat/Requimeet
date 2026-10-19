/*
  Warnings:

  - A unique constraint covering the columns `[transcriptSegmentId,originalText]` on the table `Requirement` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Requirement_transcriptSegmentId_originalText_key" ON "Requirement"("transcriptSegmentId", "originalText");
