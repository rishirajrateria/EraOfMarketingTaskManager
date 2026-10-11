/** Pure money helpers shared by server code and client components (no Prisma imports). */

const inr = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123456.5 → "1,23,456.50" (Indian digit grouping). */
export function formatINRNumber(n: number): string {
  return inr.format(Number.isFinite(n) ? n : 0);
}

/** "₹1,23,456.50" — for the UI. */
export function formatINR(n: number): string {
  return `₹${formatINRNumber(n)}`;
}

/** "₹1,23,457" — rounded to the rupee for dense tiles (ADR 0013 hub). */
export function formatINRWhole(n: number): string {
  return `₹${Math.round(Number.isFinite(n) ? n : 0).toLocaleString("en-IN")}`;
}

/** "INR 1,23,456.50" — for emails / WhatsApp text (plain ASCII). */
export function formatINRPlain(n: number): string {
  return `INR ${formatINRNumber(n)}`;
}

const grouped = (locale: string, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const inrWhole = grouped("en-IN", 0);
const inrCents = grouped("en-IN", 2);
const intlWhole = grouped("en-US", 0);
const intlCents = grouped("en-US", 2);

/** Whole amounts print without decimals, anything else with two: 30000 → "30,000", 1234.5 → "1,234.50". */
function compactNumber(n: number, whole: Intl.NumberFormat, cents: Intl.NumberFormat): string {
  const v = Number.isFinite(n) ? round2(n) : 0;
  return Number.isInteger(v) ? whole.format(v) : cents.format(v);
}

/**
 * Amount as printed on documents (ADR 0007): INR → "₹30,000" (Indian grouping, no decimals when whole),
 * any other ISO code → the code directly before the number, e.g. "AED2,700".
 */
export function formatCurrency(n: number, currency: string = "INR"): string {
  const code = (currency || "INR").trim().toUpperCase();
  if (code === "INR") return `₹${compactNumber(n, inrWhole, inrCents)}`;
  return `${code}${compactNumber(n, intlWhole, intlCents)}`;
}

/** "AED 2,700.00" / "₹2,700.00" — for UI rows that may show a foreign-currency invoice. */
export function formatMoney(n: number, currency: string = "INR"): string {
  const code = (currency || "INR").trim().toUpperCase();
  return code === "INR" ? formatINR(n) : `${code} ${intlCents.format(Number.isFinite(n) ? round2(n) : 0)}`;
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type LineInput = { qty: number; unit: "HOURS" | "FIXED"; rate: number };

/** HOURS → qty × rate; FIXED → rate (qty is informational). */
export function lineAmount(l: LineInput): number {
  return round2(l.unit === "HOURS" ? l.qty * l.rate : l.rate);
}

export function computeTotals(lines: LineInput[], gstPercent: number) {
  const subtotal = round2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const gstAmount = round2((subtotal * gstPercent) / 100);
  return { subtotal, gstAmount, total: round2(subtotal + gstAmount) };
}

/** Tolerance for "paid in full" comparisons. */
export const PAID_EPSILON = 0.005;

export type SettlementInput = {
  total: number;
  payments: { amount: number; tdsAmount?: number | null }[];
  /** Credit notes that have been approved (approvedAt set) and not cancelled. */
  creditNotes?: { total: number }[];
};

export type Settlement = { received: number; tds: number; credited: number; settled: number; balance: number; paid: boolean };

/** Balance after payments, TDS and credit notes (ADR 0005): PAID when settled ≥ total. */
export function settle(i: SettlementInput): Settlement {
  const received = round2(i.payments.reduce((s, p) => s + p.amount, 0));
  const tds = round2(i.payments.reduce((s, p) => s + (p.tdsAmount ?? 0), 0));
  const credited = round2((i.creditNotes ?? []).reduce((s, c) => s + c.total, 0));
  const settled = round2(received + tds + credited);
  const balance = round2(Math.max(0, i.total - settled));
  return { received, tds, credited, settled, balance, paid: settled >= i.total - PAID_EPSILON };
}

/** Escape one CSV cell. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
