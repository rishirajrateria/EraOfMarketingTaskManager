-- CreateEnum
CREATE TYPE "MeetingArtifactKind" AS ENUM ('SMART_NOTES', 'TRANSCRIPT');

-- AlterEnum
ALTER TYPE "IntegrationKind" ADD VALUE 'MEET_CONFIG';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "meetNotesFolderId" TEXT,
ADD COLUMN     "meetSpaceName" TEXT;

-- CreateTable
CREATE TABLE "TaskMeetingNote" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" "MeetingArtifactKind" NOT NULL,
    "conferenceRecord" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "docUrl" TEXT NOT NULL,
    "filedAs" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMeetingNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskMeetingNote_taskId_docId_key" ON "TaskMeetingNote"("taskId", "docId");

-- AddForeignKey
ALTER TABLE "TaskMeetingNote" ADD CONSTRAINT "TaskMeetingNote_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

