import { redirect } from "next/navigation";
import { requireFinancePage } from "@/server/finance/guard";

export const dynamic = "force-dynamic";

/** The Finance sheet is now part of the Payments & finance hub (ADR 0013); old links land there (keeping ?fy=). */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  await requireFinancePage();
  const sp = await searchParams;
  redirect(sp.fy === "previous" ? "/admin/payments?fy=previous#tds" : "/admin/payments");
}
