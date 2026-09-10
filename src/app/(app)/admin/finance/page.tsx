import Link from "next/link";
import { requireFinancePage } from "@/server/finance/guard";
import { caUsers, financeSummary } from "@/server/finance/queries";
import { formatINR } from "@/server/finance/money";
import { env } from "@/lib/env";
import { MonthlyBars, ClientBars } from "@/components/finance/FinanceCharts";
import { FinanceActions } from "@/components/finance/FinanceActions";

export const dynamic = "force-dynamic";

/** Finance sheet dashboard (SPEC §11.4): invoiced vs received vs outstanding, expenses, net; Sheets sync; CA access. */
export default async function FinancePage() {
  const user = await requireFinancePage();
  const [summary, cas] = await Promise.all([financeSummary(), caUsers()]);
  const t = summary.totals;
  const tiles = [
    { label: "Invoiced", value: t.invoiced, cls: "text-brand-blue" },
    { label: "Received", value: t.received, cls: "text-brand-green" },
    { label: "Outstanding", value: t.outstanding, cls: "text-amber-600" },
    { label: "Expenses", value: t.expenses, cls: "text-red-600" },
    { label: "Net", value: t.net, cls: t.net >= 0 ? "text-gray-900" : "text-red-700" },
  ];
  return (
    <main className="flex-1 bg-white pb-8">
      <div className="grid grid-cols-2 gap-2 bg-brand-blue p-3 text-white">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-lg bg-white/90 px-3 py-2">
            <div className="text-[11px] uppercase text-gray-500">{x.label}</div>
            <div className={`text-base font-bold ${x.cls}`}>{formatINR(x.value)}</div>
          </div>
        ))}
      </div>
      <FinanceActions canWrite={user.canWrite} sheetId={env.financeSheetId} />
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
            <thead className="text-left text-gray-500">
              <tr><th className="py-1">Month</th><th className="text-right">Invoiced</th><th className="text-right">Received</th><th className="text-right">Expenses</th><th className="text-right">Net</th></tr>
            </thead>
            <tbody>
              {summary.months.map((m) => (
                <tr key={m.month} className="border-t">
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
      <section className="mx-4 mt-4 rounded-lg border bg-gray-50 p-3 text-xs">
        <div className="mb-1 font-semibold">CA access (read-only)</div>
        {cas.length === 0 ? <p className="text-gray-500">No CA user yet.</p> : (
          <ul className="space-y-0.5">{cas.map((c) => <li key={c.id}>{c.name} · {c.email}</li>)}</ul>
        )}
        {user.canWrite ? (
          <Link href="/admin/people?role=CA" className="mt-2 inline-block text-brand-blue underline">Manage CA users</Link>
        ) : null}
        <div className="mt-2 flex gap-3">
          <Link href="/admin/invoices" className="text-brand-blue underline">Invoices</Link>
          <Link href="/admin/expenses" className="text-brand-blue underline">Expenses</Link>
        </div>
      </section>
    </main>
  );
}
