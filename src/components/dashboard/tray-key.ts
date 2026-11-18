/**
 * The minimisable bottom trays (ADR 0016 addendum, prototype `#dashTray` / `#addTray` + `.traytog`): the task
 * dashboard's filters, the add-task screen's details and the Admin dashboards' filters (/admin/dashboards). Each
 * remembers "minimised" per user in this browser under its own key, so collapsing one never collapses another.
 */
export type TrayKind = "filters" | "details" | "dashboards";

const KEY_PART: Record<TrayKind, string> = { filters: "dash", details: "add", dashboards: "dashboards" };

/** `eom:dash-tray-min:<user>` (the task dashboard's, unchanged) / `eom:add-tray-min:<user>` / `eom:dashboards-tray-min:<user>`. */
export const trayStorageKey = (kind: TrayKind, userId: string) => `eom:${KEY_PART[kind]}-tray-min:${userId}`;

/** The region's name and its tab's names. */
export const TRAY_NAME: Record<TrayKind, { region: string; show: string; hide: string }> = {
  filters: { region: "Filters", show: "Show filters", hide: "Hide filters" },
  details: { region: "Details", show: "Show details", hide: "Hide details" },
  dashboards: { region: "Dashboard filters", show: "Show filters", hide: "Hide filters" },
};
