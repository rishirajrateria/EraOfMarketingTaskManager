import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof prisma;
type Kind = "invoice" | "receipt" | "proforma" | "creditNote";

/**
 * Financial-year numbering (SPEC §11.3, ADR 0005): `EOM/25-26/0001`, `EOM-RCP/25-26/0001`, `EOM-PRO/25-26/0001`,
 * `EOM-CN/25-26/0001`. The FY runs 1 April – 31 March in the company timezone. CompanySettings.numberingFyKey
 * remembers which FY the counters belong to; the first allocation of a new FY resets every counter to 1.
 * Invoice numbers are allocated at approval (until then the document is `DRAFT-<id>`).
 */

/** "26-27" for any instant that falls between 1 Apr 2026 and 31 Mar 2027 in `tz`. */
export function financialYearKey(date: Date, tz: string): string {
  const year = Number(formatInTimeZone(date, tz, "yyyy"));
  const month = Number(formatInTimeZone(date, tz, "M"));
  const start = month >= 4 ? year : year - 1;
  const yy = (y: number) => String(y % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
}

/** Prefixes saved before FY numbering carried a trailing separator (`EOM-INV-`); map them to the new style. */
const LEGACY_PREFIX: Record<string, string> = { "EOM-INV-": "EOM" };

export function normalizePrefix(prefix: string): string {
  const p = LEGACY_PREFIX[prefix] ?? prefix;
  return p.replace(/[\s\-/]+$/, "") || "EOM";
}

/** `EOM` + `25-26` + 1 → `EOM/25-26/0001` (4-digit zero padding; longer numbers are never truncated). */
export function formatNumber(prefix: string, fyKey: string, n: number): string {
  return `${normalizePrefix(prefix)}/${fyKey}/${String(n).padStart(4, "0")}`;
}

export const DRAFT_PREFIX = "DRAFT-";
export const isDraftNumber = (n: string) => n.startsWith(DRAFT_PREFIX);

type SettingsRow = {
  invoicePrefix: string;
  receiptPrefix: string;
  proformaPrefix: string;
  creditNotePrefix: string;
  timezone: string;
  numberingFyKey: string;
};

const COLUMN: Record<Kind, { prefix: keyof SettingsRow; counter: string }> = {
  invoice: { prefix: "invoicePrefix", counter: "invoiceNextNumber" },
  receipt: { prefix: "receiptPrefix", counter: "receiptNextNumber" },
  proforma: { prefix: "proformaPrefix", counter: "proformaNextNumber" },
  creditNote: { prefix: "creditNotePrefix", counter: "creditNoteNextNumber" },
};

/** Locks the settings row for the rest of the transaction so concurrent allocations (and FY resets) serialise. */
async function lockSettings(tx: Tx): Promise<SettingsRow | null> {
  const rows = await tx.$queryRaw<SettingsRow[]>`
    SELECT "invoicePrefix", "receiptPrefix", "proformaPrefix", "creditNotePrefix", "timezone", "numberingFyKey"
    FROM "CompanySettings" WHERE id = 'default' FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Bring the counters into the current FY. A blank key means nothing has been numbered yet, so a configured
 * starting number is kept; any other key that differs from `key` starts a new year at 0001 for every sequence.
 */
async function rolloverIfNeeded(tx: Tx, settings: SettingsRow, key: string): Promise<void> {
  if (settings.numberingFyKey === key) return;
  const reset = settings.numberingFyKey !== "";
  await tx.companySettings.update({
    where: { id: "default" },
    data: {
      numberingFyKey: key,
      ...(reset ? { invoiceNextNumber: 1, receiptNextNumber: 1, proformaNextNumber: 1, creditNoteNextNumber: 1 } : {}),
    },
  });
}

/** Bump the counter and return the number taken — one UPDATE … RETURNING. */
async function takeNumber(tx: Tx, kind: Kind): Promise<number> {
  const col = COLUMN[kind].counter;
  const rows = await tx.$queryRawUnsafe<{ next: number }[]>(
    `UPDATE "CompanySettings" SET "${col}" = "${col}" + 1, "updatedAt" = NOW() WHERE id = 'default' RETURNING "${col}" AS next`,
  );
  return Number(rows[0].next) - 1;
}

/**
 * Atomic sequence allocation. Reads the DB directly (never the settings cache). Gap-free and unique under
 * concurrency thanks to the row lock; the first allocation of a new FY resets the sequences to 0001.
 */
async function allocate(tx: Tx, kind: Kind, now: Date): Promise<string> {
  const settings = await lockSettings(tx);
  if (!settings) {
    await tx.companySettings.create({ data: { id: "default" } }).catch(() => undefined);
    return allocate(tx, kind, now);
  }
  const key = financialYearKey(now, settings.timezone);
  await rolloverIfNeeded(tx, settings, key);
  const n = await takeNumber(tx, kind);
  return formatNumber(settings[COLUMN[kind].prefix], key, n);
}

export const allocateInvoiceNumber = (tx: Tx = prisma, now: Date = new Date()) => allocate(tx, "invoice", now);
export const allocateReceiptNumber = (tx: Tx = prisma, now: Date = new Date()) => allocate(tx, "receipt", now);
export const allocateProformaNumber = (tx: Tx = prisma, now: Date = new Date()) => allocate(tx, "proforma", now);
export const allocateCreditNoteNumber = (tx: Tx = prisma, now: Date = new Date()) => allocate(tx, "creditNote", now);

/** Series by document type: tax + export invoices share the invoice series (ADR 0005). */
export function allocateNumberFor(docType: "TAX_INVOICE" | "EXPORT_INVOICE" | "PROFORMA" | "CREDIT_NOTE", tx: Tx = prisma, now: Date = new Date()) {
  if (docType === "PROFORMA") return allocate(tx, "proforma", now);
  if (docType === "CREDIT_NOTE") return allocate(tx, "creditNote", now);
  return allocate(tx, "invoice", now);
}
