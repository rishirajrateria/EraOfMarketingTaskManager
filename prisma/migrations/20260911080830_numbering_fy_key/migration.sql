-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "numberingFyKey" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "invoicePrefix" SET DEFAULT 'EOM',
ALTER COLUMN "receiptPrefix" SET DEFAULT 'EOM-RCP';
