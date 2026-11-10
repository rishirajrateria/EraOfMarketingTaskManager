-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'TASK_PROPOSED';
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_PROPOSAL_APPROVED';
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_PROPOSAL_REJECTED';
ALTER TYPE "NotificationKind" ADD VALUE 'TASK_REASSIGNED';

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'TASK_PROPOSAL';

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decidedById" TEXT,
ADD COLUMN     "decisionNote" TEXT,
ADD COLUMN     "proposedAt" TIMESTAMP(3),
ADD COLUMN     "proposedById" TEXT,
ADD COLUMN     "requestedDate" TEXT,
ADD COLUMN     "requestedRecurrence" JSONB,
ADD COLUMN     "requestedTime" TEXT;

