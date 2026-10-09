-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('REGULAR', 'SALARY');

-- CreateEnum
CREATE TYPE "ExpenseTiming" AS ENUM ('PREPAID', 'POSTPAID', 'ADVANCE');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('DUE', 'PAID');

-- CreateEnum
CREATE TYPE "ExpenseMethod" AS ENUM ('CASH', 'UPI', 'BANK', 'CARD', 'CHEQUE');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'PAYMENT_DUE';

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "financeEmail" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "kind" "ExpenseKind" NOT NULL DEFAULT 'REGULAR',
ADD COLUMN     "plan" "BillingPlan" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "remindDays" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "repeatRule" JSONB,
ADD COLUMN     "salaryUserId" TEXT,
ADD COLUMN     "timing" "ExpenseTiming" NOT NULL DEFAULT 'PREPAID',
ADD COLUMN     "vendorGstin" TEXT;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "monthDriveFileId" TEXT;

-- CreateTable
CREATE TABLE "ExpenseOccurrence" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'DUE',
    "paidAt" TIMESTAMP(3),
    "method" "ExpenseMethod",
    "reference" TEXT,
    "tdsPercent" DECIMAL(5,2),
    "tdsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gstRate" DECIMAL(5,2),
    "vendorGstin" TEXT,
    "itcClaimable" BOOLEAN NOT NULL DEFAULT false,
    "billData" BYTEA,
    "billMime" TEXT,
    "billName" TEXT,
    "billDriveId" TEXT,
    "itcDriveId" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinanceMonthFolder" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "salesId" TEXT NOT NULL,
    "billsId" TEXT NOT NULL,
    "itcId" TEXT NOT NULL,
    "cancelledId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinanceMonthFolder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseOccurrence_status_dueDate_idx" ON "ExpenseOccurrence"("status", "dueDate");

-- CreateIndex
CREATE INDEX "ExpenseOccurrence_paidAt_idx" ON "ExpenseOccurrence"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseOccurrence_expenseId_seq_key" ON "ExpenseOccurrence"("expenseId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "FinanceMonthFolder_month_key" ON "FinanceMonthFolder"("month");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_salaryUserId_fkey" FOREIGN KEY ("salaryUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseOccurrence" ADD CONSTRAINT "ExpenseOccurrence_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- DATA MIGRATION BEGIN (ADR 0009)
-- Every existing expense becomes a one-time bill with one PAID occurrence carrying its money, TDS and receipt, so it
-- still shows under Paid and in the FY TDS totals. Idempotent: expenses that already have occurrences are skipped.
INSERT INTO "ExpenseOccurrence" (
  "id", "expenseId", "seq", "amount", "dueDate", "status", "paidAt", "tdsPercent", "tdsAmount",
  "billData", "billMime", "billName", "billDriveId", "notifiedAt", "createdAt", "updatedAt"
)
SELECT
  'occ' || md5(e."id" || '-1'), e."id", 1, e."amount", e."date", 'PAID', e."date",
  CASE WHEN e."tdsApplied" THEN e."tdsPercent" ELSE NULL END,
  CASE WHEN e."tdsApplied" THEN e."tdsAmount" ELSE 0 END,
  e."receiptImageData", e."receiptImageMime",
  CASE WHEN e."receiptImageData" IS NOT NULL THEN 'bill-' || e."id" ELSE NULL END,
  e."receiptImageDriveId", e."date", e."createdAt", CURRENT_TIMESTAMP
FROM "Expense" e
WHERE NOT EXISTS (SELECT 1 FROM "ExpenseOccurrence" o WHERE o."expenseId" = e."id");
-- DATA MIGRATION END
