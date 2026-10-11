/** Number formats for the Admin dashboards (ADR 0016). Pure. */
import { formatINRWhole } from "@/server/finance/money";

export const inr = formatINRWhole;

/** Compact rupees for axis labels: ₹0, ₹950, ₹45k, ₹1.2L, ₹3.4Cr. */
export function inrShort(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, ""));
  if (a >= 1e7) return `${sign}₹${trim(Math.round((a / 1e7) * 10) / 10)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(Math.round((a / 1e5) * 10) / 10)}L`;
  if (a >= 1e3) return `${sign}₹${trim(Math.round((a / 1e3) * 10) / 10)}k`;
  return `${sign}₹${Math.round(a)}`;
}

/** Minutes → "11.5h" ("0h" for nothing). */
export function hrs(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/** Axis maximum: the smallest 1 · 2 · 2.5 · 5 × 10ⁿ at or above the data maximum (so half of it is a round number too). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Capacity bar colour: red over 90 % booked, amber over 70 %, else the single series colour. */
export function loadTone(pct: number): "red" | "amber" | "ok" {
  return pct > 90 ? "red" : pct > 70 ? "amber" : "ok";
}
