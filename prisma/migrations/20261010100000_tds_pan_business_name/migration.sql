-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'TDS_THRESHOLD';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "pan" TEXT;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "tdsThresholdAmount" DECIMAL(12,2) NOT NULL DEFAULT 20000;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "tdsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tdsApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tdsPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "tdsApplicable" BOOLEAN NOT NULL DEFAULT false;

