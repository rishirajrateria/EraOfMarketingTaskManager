"use client";
import { useRef, useState } from "react";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { Toggle, WeekdayPicker } from "@/components/admin/AdminUi";
import { minutesToHHMM, hhmmToMinutes } from "@/lib/time";
import type { GoogleStatus } from "@/server/admin/queries";
import type { SettingsInput } from "@/server/admin/schemas";

/** Presentational sections of the Settings form (SPEC §11.9). State lives in SettingsForm. */

export type SettingsValues = Required<SettingsInput>;
export type Patch = (p: Partial<SettingsValues>) => void;

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-200 bg-white px-4 py-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Text({ label, value, onChange, hint, type = "text", rows }: { label: string; value: string; onChange: (v: string) => void; hint?: string; type?: string; rows?: number }) {
  return (
    <Field label={label} hint={hint}>
      {rows ? (
        <textarea className={inputCls} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className={inputCls} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function TimeInput({ label, value, onChange }: { label: string; value: number; onChange: (min: number) => void }) {
  return (
    <Field label={label}>
      <input className={inputCls} type="time" step={300} value={minutesToHHMM(value)} onChange={(e) => e.target.value && onChange(hhmmToMinutes(e.target.value))} />
    </Field>
  );
}

export function CompanySection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  return (
    <Section title="Company profile">
      <Text label="Company name" value={v.companyName} onChange={(companyName) => patch({ companyName })} />
      <Text label="Address" value={v.address} rows={3} onChange={(address) => patch({ address })} />
      <Text label="GST number" value={v.gstNumber} onChange={(gstNumber) => patch({ gstNumber })} />
      <Text label="Timezone" hint="IANA name, e.g. Asia/Kolkata" value={v.timezone} onChange={(timezone) => patch({ timezone })} />
    </Section>
  );
}

export function BankSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  return (
    <Section title="Bank details (printed on invoices)">
      <Text label="Bank name" value={v.bankName} onChange={(bankName) => patch({ bankName })} />
      <Text label="Account name" value={v.bankAccountName} onChange={(bankAccountName) => patch({ bankAccountName })} />
      <Text label="Account number" value={v.bankAccountNumber} onChange={(bankAccountNumber) => patch({ bankAccountNumber })} />
      <Text label="IFSC" value={v.bankIfsc} onChange={(bankIfsc) => patch({ bankIfsc })} />
      <Text label="UPI id" value={v.upiId} onChange={(upiId) => patch({ upiId })} />
    </Section>
  );
}

export function LogoSection({
  logoUrl,
  version,
  busy,
  onUpload,
  onRemove,
}: {
  logoUrl: string | null;
  version: string;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Section title="Logo">
      <div className="flex items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${logoUrl}?v=${encodeURIComponent(version)}`} alt="Company logo" className="h-16 w-16 rounded-lg border bg-white object-contain" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed text-xs text-gray-400">No logo</div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => fileRef.current?.click()}>
            {logoUrl ? "Replace logo" : "Upload logo"}
          </button>
          {logoUrl ? (
            <button type="button" className="text-left text-xs text-red-600" disabled={busy} onClick={onRemove}>
              Remove logo
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">PNG, JPG, SVG or WebP up to 2 MB. Used on invoices and receipts.</p>
    </Section>
  );
}

export function WorkingTimeSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  const productive = Math.max(0, v.workEndMinutes - v.workStartMinutes - (v.lunchEndMinutes - v.lunchStartMinutes));
  return (
    <Section title="Working time (SPEC §9.1 defaults)">
      <div className="grid grid-cols-2 gap-3">
        <TimeInput label="Work start" value={v.workStartMinutes} onChange={(workStartMinutes) => patch({ workStartMinutes })} />
        <TimeInput label="Work end" value={v.workEndMinutes} onChange={(workEndMinutes) => patch({ workEndMinutes })} />
        <TimeInput label="Lunch start" value={v.lunchStartMinutes} onChange={(lunchStartMinutes) => patch({ lunchStartMinutes })} />
        <TimeInput label="Lunch end" value={v.lunchEndMinutes} onChange={(lunchEndMinutes) => patch({ lunchEndMinutes })} />
      </div>
      <p className="text-[11px] text-gray-500">= {Math.round((productive / 60) * 10) / 10} productive hours per person per day</p>
      <Field label="Working days">
        <WeekdayPicker value={v.workingDays} onChange={(workingDays) => patch({ workingDays })} />
      </Field>
    </Section>
  );
}

export function HolidaysSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft) || v.holidays.includes(draft)) return;
    patch({ holidays: [...v.holidays, draft].sort() });
    setDraft("");
  };
  return (
    <Section title="Company holidays">
      <div className="flex gap-2">
        <input className={inputCls} type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className={btnSecondary} onClick={add} disabled={!draft}>
          Add
        </button>
      </div>
      {v.holidays.length === 0 ? (
        <p className="text-xs text-gray-400">No holidays added.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {v.holidays.map((h) => (
            <li key={h} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{h}</span>
              <button type="button" className="touch-target text-xs text-red-600" onClick={() => patch({ holidays: v.holidays.filter((x) => x !== h) })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function InvoicingSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  const num = (s: string, fallback: number) => (s === "" ? fallback : Number(s));
  return (
    <Section title="Invoicing">
      <div className="grid grid-cols-2 gap-3">
        <Text label="Invoice prefix" value={v.invoicePrefix} onChange={(invoicePrefix) => patch({ invoicePrefix })} />
        <Field label="Next invoice #">
          <input className={inputCls} type="number" min={1} value={v.invoiceNextNumber} onChange={(e) => patch({ invoiceNextNumber: num(e.target.value, 1) })} />
        </Field>
        <Text label="Receipt prefix" value={v.receiptPrefix} onChange={(receiptPrefix) => patch({ receiptPrefix })} />
        <Field label="Next receipt #">
          <input className={inputCls} type="number" min={1} value={v.receiptNextNumber} onChange={(e) => patch({ receiptNextNumber: num(e.target.value, 1) })} />
        </Field>
      </div>
      <p className="text-[11px] text-gray-400">
        Next invoice: {v.invoicePrefix}
        {String(v.invoiceNextNumber).padStart(4, "0")}
      </p>
      <Field label="Default GST %">
        <input className={inputCls} type="number" min={0} max={100} step={0.5} value={v.defaultGstPercent} onChange={(e) => patch({ defaultGstPercent: num(e.target.value, 0) })} />
      </Field>
      <Text label="Payment terms (printed on invoices)" rows={2} value={v.invoiceTerms} onChange={(invoiceTerms) => patch({ invoiceTerms })} />
      <Text
        label="Invoice email template"
        hint="Placeholders: {{client}} {{number}} {{total}} {{dueDate}} {{company}}"
        rows={5}
        value={v.invoiceEmailTemplate}
        onChange={(invoiceEmailTemplate) => patch({ invoiceEmailTemplate })}
      />
    </Section>
  );
}

export function NotificationsSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  return (
    <Section title="Notifications & workspaces">
      <Toggle label="Email notifications by default" hint="Users can override on their profile" checked={v.notifyEmailDefault} onChange={(notifyEmailDefault) => patch({ notifyEmailDefault })} />
      <Toggle label="Google Chat notifications by default" checked={v.notifyChatDefault} onChange={(notifyChatDefault) => patch({ notifyChatDefault })} />
      <Toggle label="Restart creates a new workspace" hint="New Drive folder / Chat space when a task is restarted" checked={v.restartCreatesNewWorkspace} onChange={(restartCreatesNewWorkspace) => patch({ restartCreatesNewWorkspace })} />
      <Toggle label="Recurrence creates a new workspace" hint="Each recurring instance gets its own folder / space" checked={v.recurrenceCreatesNewWorkspace} onChange={(recurrenceCreatesNewWorkspace) => patch({ recurrenceCreatesNewWorkspace })} />
    </Section>
  );
}

export function GoogleStatusSection({ status }: { status: GoogleStatus }) {
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="truncate font-mono text-gray-900">{value}</span>
    </div>
  );
  return (
    <Section title="Google integration status (read-only)">
      {row(
        "Mode",
        <span className={status.mode === "Live" ? "text-green-700" : "text-amber-600"}>{status.mode}</span>,
      )}
      {row("Service account key", status.serviceAccountKeySet ? "set" : "not set")}
      {row("Impersonated user", status.impersonateUser ?? "—")}
      {row("Workspace domain", status.workspaceDomain ?? "any")}
      {row("Drive root folder", status.driveRootFolderId ?? "auto")}
      {row("Finance sheet", status.financeSheetId ?? "auto")}
      {row("Expenses sheet", status.expensesSheetId ?? "auto")}
      <p className="text-[11px] text-gray-400">Configured through environment variables (see .env.example).</p>
    </Section>
  );
}
