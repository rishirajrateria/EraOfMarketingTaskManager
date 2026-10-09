"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { FormFooter } from "@/components/admin/AdminUi";
import { TaxBadge } from "@/components/finance/TaxBadge";
import { GST_STATE_CODES, resolveTax, stateFromGstin } from "@/server/finance/tax";
import type { ClientRow } from "@/server/admin/queries";
import type { ClientInput } from "@/server/admin/schemas";

const COUNTRIES: { code: string; name: string }[] = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "SG", name: "Singapore" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "NL", name: "Netherlands" },
  { code: "FR", name: "France" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "QA", name: "Qatar" },
  { code: "NZ", name: "New Zealand" },
  { code: "ZZ", name: "Other (outside India)" },
];
const STATES = Object.entries(GST_STATE_CODES).map(([code, name]) => ({ code, name }));

type Values = ClientInput & { tdsPercent?: number | string | null };

/** Add / edit client (SPEC §11.1 + ADR 0005): country, GST state (locked to the GSTIN), phone, WhatsApp, TDS %. */
export function ClientForm({ client, busy, companyStateCode, onSubmit, onCancel, onToggle }: { client: ClientRow | null; busy: boolean; companyStateCode: string | null; onSubmit: (v: ClientInput) => void; onCancel: () => void; onToggle?: () => void }) {
  const [v, setV] = useState<Values>({
    name: client?.name ?? "",
    contact: client?.contact ?? "",
    email: client?.email ?? "",
    gstNumber: client?.gstNumber ?? "",
    address: client?.address ?? "",
    country: client?.country ?? "IN",
    stateCode: client?.stateCode ?? "",
    stateName: client?.stateName ?? "",
    phone: client?.phone ?? "",
    whatsapp: client?.whatsapp ?? "",
    tdsPercent: client?.tdsPercent ?? "",
  });
  const set = (k: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const fromGstin = useMemo(() => stateFromGstin(v.gstNumber), [v.gstNumber]);
  const india = (v.country ?? "IN") === "IN";
  const stateCode = fromGstin?.code ?? v.stateCode ?? "";
  const tax = useMemo(() => resolveTax({ companyStateCode, client: { country: v.country, stateCode: stateCode || null, gstNumber: v.gstNumber } }), [companyStateCode, v.country, stateCode, v.gstNumber]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const tds = v.tdsPercent === "" || v.tdsPercent == null ? null : Number(v.tdsPercent);
    onSubmit({ ...v, stateCode: india ? stateCode || null : null, stateName: india ? STATES.find((s) => s.code === stateCode)?.name ?? null : null, tdsPercent: tds });
  };

  return (
    <form className="flex flex-col gap-3 px-4 pb-2 pt-3" onSubmit={submit}>
      <Field label="Client name">
        <input className={inputCls} required value={v.name} onChange={set("name")} />
      </Field>
      <Field label="Contact person">
        <input className={inputCls} value={v.contact ?? ""} onChange={set("contact")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <input className={inputCls} type="tel" value={v.phone ?? ""} onChange={set("phone")} />
        </Field>
        <Field label="WhatsApp" hint="+91…">
          <input className={inputCls} type="tel" placeholder="+919876543210" value={v.whatsapp ?? ""} onChange={set("whatsapp")} />
        </Field>
      </div>
      <Field label="Email" hint="Invoices and receipts are sent here">
        <input className={inputCls} type="email" value={v.email ?? ""} onChange={set("email")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Country">
          <select className={inputCls} value={v.country ?? "IN"} onChange={set("country")}>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="TDS %" hint="optional">
          <input className={inputCls} type="number" min="0" max="100" step="0.01" inputMode="decimal" value={v.tdsPercent ?? ""} onChange={set("tdsPercent")} />
        </Field>
      </div>
      {india ? (
        <>
          <Field label="GST number">
            <input className={inputCls} value={v.gstNumber ?? ""} onChange={set("gstNumber")} placeholder="29ABCDE1234F1Z5" autoCapitalize="characters" />
          </Field>
          <Field label="State" hint={fromGstin ? "from GSTIN" : "Decides CGST+SGST vs IGST"}>
            <select className={`${inputCls} disabled:opacity-70`} value={stateCode} disabled={!!fromGstin} onChange={set("stateCode")}>
              <option value="">— unregistered / same as company —</option>
              {STATES.map((s) => (
                <option key={s.code} value={s.code}>{s.code} · {s.name}</option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      <div className="flex items-center gap-2 text-xs text-gray-600">
        <span>Billing:</span>
        <TaxBadge tax={tax} />
      </div>
      <Field label="Address">
        <textarea className={inputCls} rows={3} value={v.address ?? ""} onChange={set("address")} />
      </Field>
      {client ? (
        <div className="glass rounded-2xl px-3 py-2 text-xs text-gray-700">
          <div>
            Drive folder:{" "}
            {client.driveFolderId ? (
              <a className="text-brand-blue underline" href={`https://drive.google.com/drive/folders/${client.driveFolderId}`} target="_blank" rel="noreferrer">open in Drive</a>
            ) : (
              <span className="text-gray-400">created with the first task</span>
            )}
          </div>
          <div>Visible in dashboard filters: {client.visibleInFilters ? "yes" : "not yet (needs a task)"}</div>
          {client.workOnHold ? <div className="font-medium text-red-700">Work on hold since {client.holdSince?.slice(0, 10)}</div> : null}
          <div>
            Vault items: {client._count.vaultItems} · <Link className="text-brand-blue underline" href={`/admin/vault?clientId=${client.id}`}>manage vault</Link>
          </div>
        </div>
      ) : null}
      <FormFooter
        busy={busy}
        onCancel={onCancel}
        extra={
          onToggle ? (
            <button type="button" className={btnSecondary} disabled={busy} onClick={onToggle}>{client?.active ? "Deactivate" : "Activate"}</button>
          ) : null
        }
      />
    </form>
  );
}
