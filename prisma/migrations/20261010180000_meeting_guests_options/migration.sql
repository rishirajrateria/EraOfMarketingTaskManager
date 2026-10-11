-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "guestEmails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "meetingOptions" JSONB;

