import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, parseDateKey } from "@/lib/time";
import { hourlyBreakdown, inventoryFor } from "@/server/inventory/queries";
import { DAY_KEY_RE, customRange, isInventoryView, periodRange, type InventoryView } from "@/server/inventory/ranges";
import { InventoryPanel } from "@/components/inventory/InventoryView";

type Search = Promise<{ view?: string; date?: string; from?: string; to?: string; teamId?: string }>;

/**
 * Inventory / sellable hours (SPEC §9.3, §11.6). Admin only.
 * `view` = day | week | month | quarter | year | custom; `date` anchors the period (defaults to today in the
 * company timezone); custom ranges use `from`/`to`.
 */
export default async function InventoryPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  const sp = await searchParams;
  const view: InventoryView = isInventoryView(sp.view) ? sp.view : "day";
  const settings = await getSettings();
  const tz = settings.timezone;
  const todayKey = dateKey(new Date(), tz);
  const anchor = sp.date && DAY_KEY_RE.test(sp.date) ? sp.date : todayKey;
  const range = view === "custom" ? customRange(sp.from, sp.to, todayKey) : periodRange(view, anchor);
  const opts = { teamId: sp.teamId || undefined };
  const [inv, hourly, teams] = await Promise.all([
    inventoryFor({ from: parseDateKey(range.from, tz), to: parseDateKey(range.to, tz) }, opts),
    view === "day" ? hourlyBreakdown(parseDateKey(range.from, tz), opts) : Promise.resolve(null),
    prisma.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <InventoryPanel inv={inv} view={view} range={range} teams={teams} teamId={sp.teamId || undefined} hourly={hourly} />;
}
