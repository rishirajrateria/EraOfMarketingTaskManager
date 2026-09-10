import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof prisma;

/**
 * Atomic sequence allocation for invoice/receipt numbers (SPEC §11.3 auto-numbering).
 * A single UPDATE … RETURNING takes a row lock on CompanySettings so concurrent transactions
 * always receive distinct, gap-free numbers. Reads the DB directly (never the settings cache).
 */
async function allocate(tx: Tx, kind: "invoice" | "receipt"): Promise<string> {
  const rows =
    kind === "invoice"
      ? await tx.$queryRaw<{ prefix: string; next: number }[]>`
          UPDATE "CompanySettings" SET "invoiceNextNumber" = "invoiceNextNumber" + 1, "updatedAt" = NOW()
          WHERE id = 'default' RETURNING "invoicePrefix" AS prefix, "invoiceNextNumber" AS next`
      : await tx.$queryRaw<{ prefix: string; next: number }[]>`
          UPDATE "CompanySettings" SET "receiptNextNumber" = "receiptNextNumber" + 1, "updatedAt" = NOW()
          WHERE id = 'default' RETURNING "receiptPrefix" AS prefix, "receiptNextNumber" AS next`;
  if (rows.length === 0) {
    await tx.companySettings.create({ data: { id: "default" } }).catch(() => undefined);
    return allocate(tx, kind);
  }
  const { prefix, next } = rows[0];
  return formatNumber(prefix, Number(next) - 1);
}

export function formatNumber(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, "0")}`;
}

export const allocateInvoiceNumber = (tx: Tx = prisma) => allocate(tx, "invoice");
export const allocateReceiptNumber = (tx: Tx = prisma) => allocate(tx, "receipt");
