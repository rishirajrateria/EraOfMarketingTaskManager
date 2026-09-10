import { redirect } from "next/navigation";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, parseDateKey } from "@/lib/time";
import { inventoryFor } from "@/server/inventory/queries";
import { InventoryPanel, type InventoryView } from "@/components/inventory/InventoryView";

type Search = Promise<{ view?: string; from?: string; to?: string; teamId?: string }>;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function rangeFor(view: InventoryView, tz: string, from?: string, to?: string): { from: Date; to: Date } {
  const localNow = toZonedTime(new Date(), tz);
  // `localNow` carries the company-tz wall clock in its local fields, so plain `format` yields the local key.
  const key = (d: Date) => format(d, "yyyy-MM-dd");
  if (view === "custom" && from && to && DAY_KEY.test(from) && DAY_KEY.test(to) && from <= to) {
    return { from: parseDateKey(from, tz), to: parseDateKey(to, tz) };
  }
  if (view === "week") {
    const s = startOfWeek(localNow, { weekStartsOn: 1 });
    return { from: parseDateKey(key(s), tz), to: parseDateKey(key(endOfWeek(localNow, { weekStartsOn: 1 })), tz) };
  }
  if (view === "month") {
    return { from: parseDateKey(key(startOfMonth(localNow)), tz), to: parseDateKey(key(endOfMonth(localNow)), tz) };
  }
  const today = parseDateKey(dateKey(new Date(), tz), tz);
  return view === "custom" ? { from: today, to: addDays(today, 6) } : { from: today, to: today };
}

/** Inventory / sellable hours (SPEC §9.3, §11.6). Admin only. */
export default async function InventoryPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/");
  const sp = await searchParams;
  const view: InventoryView = sp.view === "week" || sp.view === "month" || sp.view === "custom" ? sp.view : "today";
  const settings = await getSettings();
  const range = rangeFor(view, settings.timezone, sp.from, sp.to);
  const [inv, teams] = await Promise.all([
    inventoryFor(range, { teamId: sp.teamId || undefined }),
    prisma.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return <InventoryPanel inv={inv} view={view} from={inv.days[0]} to={inv.days[inv.days.length - 1]} teams={teams} teamId={sp.teamId || undefined} />;
}
