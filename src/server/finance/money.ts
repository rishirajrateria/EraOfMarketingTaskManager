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

/** "INR 1,23,456.50" — for PDFs/emails (standard PDF fonts lack the ₹ glyph). */
export function formatINRPlain(n: number): string {
  return `INR ${formatINRNumber(n)}`;
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

/** Escape one CSV cell. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
