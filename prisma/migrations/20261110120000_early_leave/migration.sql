-- CreateEnum
CREATE TYPE "EarlyLeaveMode" AS ENUM ('UNTIL', 'ASK');

-- CreateEnum
CREATE TYPE "EarlyLeaveReason" AS ENUM ('SICK', 'PERSONAL', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'EARLY_LEAVE';
ALTER TYPE "NotificationKind" ADD VALUE 'BACK_QUESTION';

-- CreateTable
CREATE TABLE "EarlyLeave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "leftAt" TIMESTAMP(3) NOT NULL,
    "reason" "EarlyLeaveReason" NOT NULL,
    "mode" "EarlyLeaveMode" NOT NULL,
    "until" DATE,
    "coveredThrough" DATE NOT NULL,
    "askDay" DATE,
    "askedAt" TIMESTAMP(3),
    "backOn" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarlyLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EarlyLeave_userId_active_idx" ON "EarlyLeave"("userId", "active");

-- CreateIndex
CREATE INDEX "EarlyLeave_active_coveredThrough_idx" ON "EarlyLeave"("active", "coveredThrough");

-- AddForeignKey
ALTER TABLE "EarlyLeave" ADD CONSTRAINT "EarlyLeave_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarlyLeave" ADD CONSTRAINT "EarlyLeave_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

