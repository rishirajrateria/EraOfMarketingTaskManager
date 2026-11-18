-- CreateEnum
CREATE TYPE "BalanceMode" AS ENUM ('DATE', 'MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "balanceMode" "BalanceMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3);
