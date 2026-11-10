-- CreateEnum
CREATE TYPE "InvoiceDocType" AS ENUM ('TAX_INVOICE', 'EXPORT_INVOICE', 'PROFORMA', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "TaxMode" AS ENUM ('CGST_SGST', 'IGST', 'EXPORT_LUT', 'NONE');

-- CreateEnum
CREATE TYPE "BillingPlan" AS ENUM ('ONE_TIME', 'RECURRING', 'PART');

-- CreateEnum
CREATE TYPE "MonthAnchor" AS ENUM ('NONE', 'START', 'END');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK', 'UPI', 'OTHER');

-- CreateEnum
CREATE TYPE "PartKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "PartStatus" AS ENUM ('PENDING', 'ISSUED', 'PAID', 'MERGED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InvoiceStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "InvoiceStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'INVOICE_APPROVAL_DUE';
ALTER TYPE "NotificationKind" ADD VALUE 'WORK_ON_HOLD';
ALTER TYPE "NotificationKind" ADD VALUE 'WORK_RESUMED';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'IN',
ADD COLUMN     "holdInvoiceId" TEXT,
ADD COLUMN     "holdSince" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "stateName" TEXT,
ADD COLUMN     "tdsPercent" DECIMAL(5,2),
ADD COLUMN     "whatsapp" TEXT,
ADD COLUMN     "workOnHold" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "creditNoteNextNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "creditNotePrefix" TEXT NOT NULL DEFAULT 'EOM-CN',
ADD COLUMN     "invoiceWhatsappTemplate" TEXT NOT NULL DEFAULT 'Hi {{client}}, invoice {{number}} for INR {{total}} is due on {{dueDate}}. PDF: {{link}} — {{company}}',
ADD COLUMN     "lutNumber" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "proformaNextNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "proformaPrefix" TEXT NOT NULL DEFAULT 'EOM-PRO',
ADD COLUMN     "reminderWhatsappTemplate" TEXT NOT NULL DEFAULT 'Gentle reminder from {{company}}: invoice {{number}} (INR {{balance}} outstanding) was due on {{dueDate}}. PDF: {{link}}',
ADD COLUMN     "stateCode" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "creditNoteOfId" TEXT,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "docType" "InvoiceDocType" NOT NULL DEFAULT 'TAX_INVOICE',
ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "igstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "partSeq" INTEGER,
ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "plan" "BillingPlan" NOT NULL DEFAULT 'ONE_TIME',
ADD COLUMN     "planId" TEXT,
ADD COLUMN     "proformaOfId" TEXT,
ADD COLUMN     "publicToken" TEXT,
ADD COLUMN     "remindAt" TIMESTAMP(3),
ADD COLUMN     "sgstAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxMode" "TaxMode" NOT NULL DEFAULT 'CGST_SGST',
ADD COLUMN     "whatsappSentAt" TIMESTAMP(3),
ADD COLUMN     "whatsappStatus" TEXT;

-- AlterTable
-- Preserve existing payment methods while switching the column to the PaymentMethod enum
ALTER TABLE "Payment" ADD COLUMN "method_new" "PaymentMethod" NOT NULL DEFAULT 'BANK';
UPDATE "Payment" SET "method_new" = CASE
  WHEN upper("method") LIKE '%CASH%' THEN 'CASH'::"PaymentMethod"
  WHEN upper("method") LIKE '%UPI%' THEN 'UPI'::"PaymentMethod"
  WHEN upper("method") LIKE '%BANK%' OR upper("method") LIKE '%NEFT%' OR upper("method") LIKE '%RTGS%' OR upper("method") LIKE '%IMPS%' OR upper("method") LIKE '%TRANSFER%' THEN 'BANK'::"PaymentMethod"
  ELSE 'OTHER'::"PaymentMethod" END;
ALTER TABLE "Payment" DROP COLUMN "method";
ALTER TABLE "Payment" RENAME COLUMN "method_new" TO "method";
ALTER TABLE "Payment" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "tdsAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tdsPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "RecurrenceRule" ADD COLUMN     "monthAnchor" "MonthAnchor" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "InvoicePlan" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "gstPercent" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "status" "PlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoicePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoicePart" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "PartKind" NOT NULL DEFAULT 'PERCENT',
    "value" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "PartStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePart_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePart_invoiceId_key" ON "InvoicePart"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePart_planId_seq_key" ON "InvoicePart"("planId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_publicToken_key" ON "Invoice"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_proformaOfId_key" ON "Invoice"("proformaOfId");

-- CreateIndex
CREATE INDEX "Invoice_remindAt_idx" ON "Invoice"("remindAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InvoicePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_proformaOfId_fkey" FOREIGN KEY ("proformaOfId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_creditNoteOfId_fkey" FOREIGN KEY ("creditNoteOfId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePlan" ADD CONSTRAINT "InvoicePlan_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePart" ADD CONSTRAINT "InvoicePart_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InvoicePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

