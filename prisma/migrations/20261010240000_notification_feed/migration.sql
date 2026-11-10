-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'TASK_STARTED_LATE';
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_NOT_STARTED';
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_PAST_END';
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_COMPLETED';
ALTER TYPE "NotificationKind" ADD VALUE 'PAYMENT_RECEIVED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "notStartedNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "pastEndNotifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");


-- Backfill (ADR 0017): tasks the old overdue job already announced don't get the new one-time updates again.
UPDATE "Task" SET "notStartedNotifiedAt" = "overdueNotifiedAt"
  WHERE "overdueNotifiedAt" IS NOT NULL AND "scheduledStart" IS NOT NULL AND "scheduledStart" <= "overdueNotifiedAt";
UPDATE "Task" SET "pastEndNotifiedAt" = "overdueNotifiedAt"
  WHERE "overdueNotifiedAt" IS NOT NULL AND "scheduledEnd" IS NOT NULL AND "scheduledEnd" <= "overdueNotifiedAt";
