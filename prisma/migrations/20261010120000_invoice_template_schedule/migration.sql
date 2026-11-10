-- AlterEnum
ALTER TYPE "MonthAnchor" ADD VALUE 'DAY';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR';

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "bankAddress" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bankSwift" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "hsnSacCode" TEXT NOT NULL DEFAULT '998361',
ADD COLUMN     "iecCode" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "legalName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pan" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "signatureData" BYTEA,
ADD COLUMN     "signatureUrl" TEXT,
ADD COLUMN     "website" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR';

-- AlterTable
ALTER TABLE "RecurrenceRule" ADD COLUMN     "dayOfMonth" INTEGER,
ADD COLUMN     "notifyMinutes" INTEGER NOT NULL DEFAULT 540;

