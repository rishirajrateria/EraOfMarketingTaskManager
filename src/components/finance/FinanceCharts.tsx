import type { MonthSummary } from "@/server/finance/queries";
import { formatINR } from "@/server/finance/money";

/** Inline SVG grouped bar chart (no chart library) — invoiced vs received per month, expenses per month (SPEC §11.4). */
const SERIES: { key: keyof MonthSummary; label: string; color: string }[] = [
  { key: "invoiced", label: "Invoiced", color: "#1e63d6" },
  { key: "received", label: "Received", color: "#16a34a" },
  { key: "expenses", label: "Expenses", color: "#dc2626" },
];

function short(n: number): string {
  if (n >= 1e7) return `${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

export function MonthlyBars({ months, keys = ["invoiced", "received", "expenses"] }: { months: MonthSummary[]; keys?: (keyof MonthSummary)[] }) {
  const series = SERIES.filter((s) => keys.includes(s.key));
  const W = 440;
  const H = 180;
  const padL = 36;
  const padB = 22;
  const padT = 8;
  const max = Math.max(1, ...months.flatMap((m) => series.map((s) => Number(m[s.key]))));
  const groupW = (W - padL) / months.length;
  const barW = Math.max(2, (groupW - 6) / series.length);
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Monthly finance chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={padL - 4} y={y(t) + 3} fontSize={8} textAnchor="end" fill="#6b7280">{short(t)}</text>
          </g>
        ))}
        {months.map((m, i) => (
          <g key={m.month}>
            {series.map((s, j) => {
              const v = Number(m[s.key]);
              const x = padL + i * groupW + 3 + j * barW;
              return <rect key={s.key} x={x} y={y(v)} width={barW - 1} height={Math.max(0, H - padB - y(v))} fill={s.color} rx={1}><title>{`${m.month} ${s.label}: ${formatINR(v)}`}</title></rect>;
            })}
            <text x={padL + i * groupW + groupW / 2} y={H - 8} fontSize={7} textAnchor="middle" fill="#6b7280">{m.month.slice(5)}/{m.month.slice(2, 4)}</text>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal stacked bar per client: received (green) + outstanding (amber) = invoiced. */
export function ClientBars({ clients }: { clients: { clientId: string; clientName: string; invoiced: number; received: number; outstanding: number }[] }) {
  const max = Math.max(1, ...clients.map((c) => c.invoiced));
  return (
    <ul className="space-y-2">
      {clients.map((c) => (
        <li key={c.clientId}>
          <div className="flex justify-between text-xs"><span className="truncate font-medium">{c.clientName}</span><span className="text-gray-500">{formatINR(c.invoiced)}</span></div>
          <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="bg-brand-green" style={{ width: `${(c.received / max) * 100}%` }} title={`Received ${formatINR(c.received)}`} />
            <div className="bg-amber-400" style={{ width: `${(c.outstanding / max) * 100}%` }} title={`Outstanding ${formatINR(c.outstanding)}`} />
          </div>
          <div className="mt-0.5 flex justify-between text-[10px] text-gray-500"><span>received {formatINR(c.received)}</span><span>outstanding {formatINR(c.outstanding)}</span></div>
        </li>
      ))}
    </ul>
  );
}
