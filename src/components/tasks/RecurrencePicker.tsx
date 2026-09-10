"use client";
import { clsx } from "@/lib/clsx";
import { inputCls } from "@/components/ui/Field";
import { DEFAULT_RECURRENCE, WEEKDAYS, type Recurrence } from "@/components/tasks/add-task-helpers";

const FREQUENCIES: { id: Recurrence["frequency"]; label: string }[] = [
  { id: "DAILY", label: "Daily" },
  { id: "WEEKLY", label: "Weekly" },
  { id: "MONTHLY", label: "Monthly" },
  { id: "CUSTOM", label: "Custom" },
];

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={clsx(
        "touch-target rounded-full px-3 text-xs font-medium transition",
        active ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
      )}
    >
      {children}
    </button>
  );
}

/** "Loop" — recurrence rule editor (SPEC §6, §13): Daily / Weekly / Monthly / Custom, trigger, end date or Infinite. */
export function RecurrencePicker({ value, onChange }: { value: Recurrence | null; onChange: (r: Recurrence | null) => void }) {
  const set = (patch: Partial<Recurrence>) => onChange({ ...(value ?? DEFAULT_RECURRENCE), ...patch });
  const summary = value ? describeRecurrence(value) : "Off";

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onChange(value ? null : DEFAULT_RECURRENCE)}
          aria-pressed={!!value}
          className={clsx("touch-target flex items-center gap-2 rounded-full px-3 text-sm font-semibold", value ? "bg-brand-blue text-white" : "bg-white text-gray-700 ring-1 ring-gray-300")}
        >
          <span aria-hidden>🔁</span> Loop
        </button>
        <span className="truncate text-xs text-gray-500">{summary}</span>
      </div>

      {value ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            {FREQUENCIES.map((f) => (
              <Chip key={f.id} active={value.frequency === f.id} onClick={() => set({ frequency: f.id, interval: 1 })}>
                {f.label}
              </Chip>
            ))}
          </div>

          {value.frequency === "WEEKLY" ? (
            <div className="flex gap-1" role="group" aria-label="Weekdays">
              {WEEKDAYS.map((d, i) => (
                <Chip
                  key={i}
                  label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                  active={value.byWeekday.includes(i)}
                  onClick={() => set({ byWeekday: value.byWeekday.includes(i) ? value.byWeekday.filter((x) => x !== i) : [...value.byWeekday, i].sort() })}
                >
                  {d}
                </Chip>
              ))}
            </div>
          ) : null}

          {value.frequency === "CUSTOM" ? (
            <label className="flex items-center gap-2 text-sm">
              Every
              <input
                type="number"
                min={1}
                max={365}
                value={value.interval}
                onChange={(e) => set({ interval: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })}
                className={clsx(inputCls, "w-20")}
                aria-label="Interval in days"
              />
              days
            </label>
          ) : null}

          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-gray-600">Next occurrence</span>
            <select value={value.trigger} onChange={(e) => set({ trigger: e.target.value as Recurrence["trigger"] })} className={inputCls}>
              <option value="ON_SCHEDULE">On schedule (at the scheduled time)</option>
              <option value="ON_COMPLETE">On complete (when approved complete)</option>
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Chip active={value.endDate === null} onClick={() => set({ endDate: null })}>
              ∞ Infinite
            </Chip>
            <label className="flex items-center gap-2 text-xs text-gray-600">
              or until
              <input
                type="date"
                value={value.endDate ?? ""}
                onChange={(e) => set({ endDate: e.target.value || null })}
                className={clsx(inputCls, "w-auto")}
                aria-label="Recurrence end date"
              />
            </label>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function describeRecurrence(r: Recurrence): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const base =
    r.frequency === "DAILY"
      ? "Daily"
      : r.frequency === "WEEKLY"
        ? r.byWeekday.length
          ? `Weekly on ${r.byWeekday.map((d) => names[d]).join(", ")}`
          : "Weekly"
        : r.frequency === "MONTHLY"
          ? "Monthly"
          : `Every ${r.interval} day${r.interval === 1 ? "" : "s"}`;
  return `${base} · ${r.trigger === "ON_COMPLETE" ? "on complete" : "on schedule"} · ${r.endDate ? `until ${r.endDate}` : "infinite"}`;
}
