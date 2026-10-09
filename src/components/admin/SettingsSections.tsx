"use client";
import { useState } from "react";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { Toggle, WeekdayPicker, hoursToMinutes, minutesToHours } from "@/components/admin/AdminUi";
import { minutesToHHMM, hhmmToMinutes } from "@/lib/time";
import { GST_STATE_CODES, stateFromGstin } from "@/server/finance/tax";
import type { GoogleStatus } from "@/server/admin/queries";
import type { SettingsInput } from "@/server/admin/schemas";

/** Presentational sections of the Settings form (SPEC §11.9). State lives in SettingsForm. */

export type SettingsValues = Required<SettingsInput>;
export type Patch = (p: Partial<SettingsValues>) => void;

/** Jump targets for the bottom-zone section pills (SettingsForm). */
export const SETTINGS_SECTIONS: { id: string; label: string }[] = [
  { id: "company", label: "Company" },
  { id: "logo", label: "Logo & signature" },
  { id: "bank", label: "Pay to" },
  { id: "working-time", label: "Working time" },
  { id: "holidays", label: "Holidays" },
  { id: "invoicing", label: "Invoicing" },
  { id: "expenses", label: "Expenses" },
  { id: "tds", label: "TDS" },
  { id: "notifications", label: "Notifications" },
  { id: "google", label: "Google" },
];

export function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-2 border-b border-white/60 bg-white/55 px-4 py-4 backdrop-blur-md">
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

const STATES = Object.entries(GST_STATE_CODES).map(([code, name]) => ({ code, name }));

/** ADR 0007: the "Invoice From" block of every invoice. The state is filled from the GSTIN but stays editable. */
export function CompanySection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  const fromGstin = stateFromGstin(v.gstNumber);
  const setGstin = (gstNumber: string) => {
    const derived = stateFromGstin(gstNumber);
    patch(derived ? { gstNumber, stateCode: derived.code } : { gstNumber });
  };
  return (
    <Section id="company" title="Company (printed on every invoice)">
      <Text label="Brand name" hint="Shown next to the logo and in emails" value={v.companyName} onChange={(companyName) => patch({ companyName })} />
      <Text label="Legal name" hint="Printed under “Invoice From”; blank = brand name" value={v.legalName ?? ""} onChange={(legalName) => patch({ legalName })} />
      <div className="grid grid-cols-2 gap-3">
        <Text label="GSTIN" value={v.gstNumber} onChange={setGstin} />
        <Field label="State" hint={fromGstin ? `from GSTIN · ${fromGstin.name}` : "Decides CGST+SGST vs IGST"}>
          <select className={inputCls} value={v.stateCode ?? ""} onChange={(e) => patch({ stateCode: e.target.value })}>
            <option value="">— not set —</option>
            {STATES.map((st) => (
              <option key={st.code} value={st.code}>{st.code} · {st.name}</option>
            ))}
          </select>
        </Field>
        <Text label="PAN" value={v.pan ?? ""} onChange={(pan) => patch({ pan })} />
        <Text label="LUT number" hint="Required on export invoices" value={v.lutNumber ?? ""} onChange={(lutNumber) => patch({ lutNumber })} />
        <Text label="IEC code" value={v.iecCode ?? ""} onChange={(iecCode) => patch({ iecCode })} />
        <Text label="HSN / SAC" hint="Printed in the footer" value={v.hsnSacCode ?? ""} onChange={(hsnSacCode) => patch({ hsnSacCode })} />
      </div>
      <Text label="Billing address" value={v.address} rows={3} onChange={(address) => patch({ address })} />
      <div className="grid grid-cols-2 gap-3">
        <Text label="Billing email" type="email" value={v.email ?? ""} onChange={(email) => patch({ email })} />
        <Text label="Phone" type="tel" value={v.phone ?? ""} onChange={(phone) => patch({ phone })} />
      </div>
      <Text label="Website" value={v.website ?? ""} onChange={(website) => patch({ website })} />
      <Text label="Timezone" hint="IANA name, e.g. Asia/Kolkata" value={v.timezone} onChange={(timezone) => patch({ timezone })} />
    </Section>
  );
}

/** ADR 0007: the "Pay To" block of every invoice. */
export function BankSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  return (
    <Section id="bank" title="Pay to (printed on every invoice)">
      <Text label="Account name" value={v.bankAccountName} onChange={(bankAccountName) => patch({ bankAccountName })} />
      <Text label="Account number" value={v.bankAccountNumber} onChange={(bankAccountNumber) => patch({ bankAccountNumber })} />
      <div className="grid grid-cols-2 gap-3">
        <Text label="Swift / BIC" value={v.bankSwift ?? ""} onChange={(bankSwift) => patch({ bankSwift })} />
        <Text label="IFSC" value={v.bankIfsc} onChange={(bankIfsc) => patch({ bankIfsc })} />
      </div>
      <Text label="Bank name" value={v.bankName} onChange={(bankName) => patch({ bankName })} />
      <Text label="Bank address" rows={2} value={v.bankAddress ?? ""} onChange={(bankAddress) => patch({ bankAddress })} />
      <Text label="UPI id" hint="When set, a “Scan to pay” QR is printed beside the bank details" value={v.upiId} onChange={(upiId) => patch({ upiId })} />
    </Section>
  );
}

export function WorkingTimeSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  const productive = Math.max(0, v.workEndMinutes - v.workStartMinutes - (v.lunchEndMinutes - v.lunchStartMinutes));
  return (
    <Section id="working-time" title="Working time (SPEC §9.1 defaults)">
      <div className="grid grid-cols-2 gap-3">
        <TimeInput label="Work start" value={v.workStartMinutes} onChange={(workStartMinutes) => patch({ workStartMinutes })} />
        <TimeInput label="Work end" value={v.workEndMinutes} onChange={(workEndMinutes) => patch({ workEndMinutes })} />
        <TimeInput label="Lunch start" value={v.lunchStartMinutes} onChange={(lunchStartMinutes) => patch({ lunchStartMinutes })} />
        <TimeInput label="Lunch end" value={v.lunchEndMinutes} onChange={(lunchEndMinutes) => patch({ lunchEndMinutes })} />
      </div>
      <p className="text-[11px] text-gray-500">= {Math.round((productive / 60) * 10) / 10} productive hours per person per day</p>
      <Field label="Half-day hours" hint="Capacity counted for a HALF_DAY attendance mark (ADR 0004)">
        <input
          className={inputCls}
          type="number"
          min={0}
          max={24}
          step={0.5}
          inputMode="decimal"
          value={minutesToHours(v.halfDayMinutes)}
          onChange={(e) => patch({ halfDayMinutes: hoursToMinutes(e.target.value) ?? 0 })}
        />
      </Field>
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
    <Section id="holidays" title="Company holidays">
      <div className="flex gap-2">
        <input className={inputCls} type="date" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="button" className={btnSecondary} onClick={add} disabled={!draft}>
          Add
        </button>
      </div>
      {v.holidays.length === 0 ? (
        <p className="text-xs text-gray-400">No holidays added.</p>
      ) : (
        <ul className="glass divide-y divide-white/60 rounded-2xl">
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
    <Section id="invoicing" title="Invoicing">
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

/** ADR 0006: TDS threshold on expenses — per payee, per financial year. */
export function TdsSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  return (
    <Section id="tds" title="TDS">
      <Field label="TDS threshold on expenses (₹)" hint="Per payee, per financial year (resets every 1 April)">
        <input className={inputCls} type="number" min={0} step={1} inputMode="decimal" value={v.tdsThresholdAmount} onChange={(e) => patch({ tdsThresholdAmount: e.target.value === "" ? 0 : Number(e.target.value) })} />
      </Field>
      <p className="text-[11px] text-gray-400">Once payments to one payee reach this amount within the financial year, the expense form warns and admins are notified to deduct TDS.</p>
    </Section>
  );
}

export function NotificationsSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  return (
    <Section id="notifications" title="Notifications & workspaces">
      <Toggle label="Email notifications by default" hint="Users can override on their profile" checked={v.notifyEmailDefault} onChange={(notifyEmailDefault) => patch({ notifyEmailDefault })} />
      <Toggle label="Post notifications into task Chat spaces" hint="Off by default; in-app and push notifications are always sent" checked={v.notifyChatDefault} onChange={(notifyChatDefault) => patch({ notifyChatDefault })} />
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
    <Section id="google" title="Google integration status (read-only)">
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
