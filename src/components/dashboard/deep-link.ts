/**
 * `/dashboard?task=<id>` (a tapped notification, a Requests "Open task", ADR 0017): scroll to the card, flash it, then
 * open its (i) sheet. Pure planning so it can be unit-tested; the Dashboard does the DOM work.
 */
export const FLASH_MS = 1600;
/** The sheet opens after the card has been scrolled to and has started flashing. */
export const OPEN_AFTER_MS = 450;

export type DeepLinkPlan =
  /** Not on this user's list (deleted, not visible, or long gone) — say so instead of opening nothing. */
  | { kind: "missing" }
  /** On the list: flash + scroll when the card is shown under the current filters, else just open the sheet. */
  | { kind: "open"; flash: boolean };

export function planDeepLink(taskId: string | null, known: ReadonlySet<string>, shown: ReadonlySet<string>): DeepLinkPlan | null {
  if (!taskId) return null;
  if (!known.has(taskId)) return { kind: "missing" };
  return { kind: "open", flash: shown.has(taskId) };
}

/** The URL after the deep link is consumed: `task` / `completed` / `edit` are dropped, anything else is kept. */
export function strippedDashboardUrl(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  for (const k of ["task", "completed", "edit"]) q.delete(k);
  const s = q.toString();
  return `${pathname}${s ? `?${s}` : ""}`;
}
