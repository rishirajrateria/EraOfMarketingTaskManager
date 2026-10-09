import Link from "next/link";
import { requireFinancePage } from "@/server/finance/guard";
import { financeSummary } from "@/server/finance/queries";
import { formatINR } from "@/server/finance/money";
import { env } from "@/lib/env";
import { MonthlyBars, ClientBars } from "@/components/finance/FinanceCharts";
import { FinanceActions } from "@/components/finance/FinanceActions";
import { Screen } from "@/components/admin/AdminUi";

export const dynamic = "force-dynamic";

/** Finance sheet dashboard (SPEC §11.4): invoiced vs received vs outstanding, expenses, net; push-only Sheets mirror. ADMIN only. */
export default async function FinancePage() {
  const user = await requireFinancePage();
  const summary = await financeSummary();
  const t = summary.totals;
  const tiles = [
    { label: "Invoiced", value: t.invoiced, cls: "text-brand-blue" },
    { label: "Received", value: t.received, cls: "text-brand-green" },
    { label: "Outstanding", value: t.outstanding, cls: "text-amber-600" },
    { label: "Expenses", value: t.expenses, cls: "text-red-600" },
    { label: "Net", value: t.net, cls: t.net >= 0 ? "text-gray-900" : "text-red-700" },
  ];
  return (
    <Screen
      header={
        <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-3 pb-3 pt-2 text-white backdrop-blur-xl">
          <h1 className="pb-2 text-base font-semibold">Finance sheet</h1>
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((x) => (
              <div key={x.label} className="rounded-lg border border-white/60 bg-white/85 px-3 py-2 backdrop-blur-md">
                <div className="text-[11px] uppercase text-gray-600">{x.label}</div>
                <div className={`text-base font-bold ${x.cls}`}>{formatINR(x.value)}</div>
              </div>
            ))}
          </div>
        </div>
      }
      zone={<FinanceActions canWrite={user.canWrite} sheetId={env.financeSheetId} />}
      className="bg-white/55 pb-4 backdrop-blur-md"
    >
      <section className="px-4 pt-2">
        <h2 className="mb-2 text-sm font-semibold">Last 12 months</h2>
        <MonthlyBars months={summary.months} />
      </section>
      <section className="px-4 pt-4">
        <h2 className="mb-2 text-sm font-semibold">Per client</h2>
        {summary.clients.length === 0 ? <p className="text-xs text-gray-500">No sent invoices yet.</p> : <ClientBars clients={summary.clients} />}
      </section>
      <section className="px-4 pt-4">
        <h2 className="mb-2 text-sm font-semibold">Per month</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-white/40 text-left text-gray-600">
              <tr><th className="py-1">Month</th><th className="text-right">Invoiced</th><th className="text-right">Received</th><th className="text-right">Expenses</th><th className="text-right">Net</th></tr>
            </thead>
            <tbody>
              {summary.months.map((m) => (
                <tr key={m.month} className="border-t border-white/60">
                  <td className="py-1">{m.month}</td>
                  <td className="text-right">{formatINR(m.invoiced)}</td>
                  <td className="text-right">{formatINR(m.received)}</td>
                  <td className="text-right">{formatINR(m.expenses)}</td>
                  <td className={`text-right ${m.net < 0 ? "text-red-600" : ""}`}>{formatINR(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="glass mx-4 mt-4 rounded-2xl p-3 text-xs">
        <div className="flex gap-3">
          <Link href="/admin/invoices" className="text-brand-blue underline">Invoices</Link>
          <Link href="/admin/payments" className="text-brand-blue underline">Payments</Link>
          <Link href="/admin/expenses" className="text-brand-blue underline">Expenses</Link>
        </div>
      </section>
    </Screen>
  );
}
