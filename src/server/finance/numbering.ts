import type { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient | typeof prisma;
type Kind = "invoice" | "receipt";

/**
 * Financial-year numbering (SPEC §11.3): `EOM/25-26/0001`, `EOM-RCP/25-26/0001`.
 * The FY runs 1 April – 31 March in the company timezone. CompanySettings.numberingFyKey remembers which
 * FY the counters belong to; the first allocation of a new FY resets both counters to 1.
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

type SettingsRow = { invoicePrefix: string; receiptPrefix: string; timezone: string; numberingFyKey: string };

/** Locks the settings row for the rest of the transaction so concurrent allocations (and FY resets) serialise. */
async function lockSettings(tx: Tx): Promise<SettingsRow | null> {
  const rows = await tx.$queryRaw<SettingsRow[]>`
    SELECT "invoicePrefix", "receiptPrefix", "timezone", "numberingFyKey" FROM "CompanySettings" WHERE id = 'default' FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Bring the counters into the current FY. A blank key means nothing has been numbered yet, so a configured
 * starting number is kept; any other key that differs from `key` starts a new year at 0001 for both sequences.
 */
async function rolloverIfNeeded(tx: Tx, settings: SettingsRow, key: string): Promise<void> {
  if (settings.numberingFyKey === key) return;
  const reset = settings.numberingFyKey !== "";
  await tx.companySettings.update({
    where: { id: "default" },
    data: { numberingFyKey: key, ...(reset ? { invoiceNextNumber: 1, receiptNextNumber: 1 } : {}) },
  });
}

/** Bump the counter and return the number taken — one UPDATE … RETURNING. */
async function takeNumber(tx: Tx, kind: Kind): Promise<number> {
  const rows =
    kind === "invoice"
      ? await tx.$queryRaw<{ next: number }[]>`
          UPDATE "CompanySettings" SET "invoiceNextNumber" = "invoiceNextNumber" + 1, "updatedAt" = NOW()
          WHERE id = 'default' RETURNING "invoiceNextNumber" AS next`
      : await tx.$queryRaw<{ next: number }[]>`
          UPDATE "CompanySettings" SET "receiptNextNumber" = "receiptNextNumber" + 1, "updatedAt" = NOW()
          WHERE id = 'default' RETURNING "receiptNextNumber" AS next`;
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
  return formatNumber(kind === "invoice" ? settings.invoicePrefix : settings.receiptPrefix, key, n);
}

export const allocateInvoiceNumber = (tx: Tx = prisma, now: Date = new Date()) => allocate(tx, "invoice", now);
export const allocateReceiptNumber = (tx: Tx = prisma, now: Date = new Date()) => allocate(tx, "receipt", now);
