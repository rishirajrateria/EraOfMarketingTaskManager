"use client";
import { Toggle } from "@/components/admin/AdminUi";
import { TaxBadge } from "@/components/finance/TaxBadge";
import { contactWarnings } from "@/components/finance/invoice-form-helpers";
import { FieldError, type StepProps } from "@/components/finance/wizard/types";

/** Step 1 — pick the client: pill list filtered by the search strip, then the tax badge + contact check. */
export function StepClient({ form, set, errors, clients, tax, query }: StepProps & { query: string }) {
  const q = query.trim().toLowerCase();
  const shown = clients.filter((c) => !q || c.name.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q));
  const picked = clients.find((c) => c.id === form.clientId) ?? null;
  const warnings = picked ? contactWarnings(picked) : [];
  return (
    <div className="space-y-4 px-4 py-4">
      <div>
        <div className="mb-2 text-xs font-medium text-gray-600">{form.partEdit ? "Part payments stay with their client. To bill someone else, delete the draft and create it again." : "Who is this invoice for?"}</div>
        {shown.length === 0 ? <p className="text-sm text-gray-500">{clients.length === 0 ? "Add a client first (Admin menu → Add Client)." : "No clients match."}</p> : null}
        <div className="flex flex-wrap gap-2">
          {shown.map((c) => {
            const active = c.id === form.clientId;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                disabled={form.partEdit && !active}
                onClick={() => set({ clientId: c.id, tdsApplicable: (c.country ?? "IN").toUpperCase() === "IN" && c.tdsPercent != null, currency: c.country?.toUpperCase() === "IN" ? "INR" : c.currency || "INR" })}
                className={`touch-target rounded-full px-3.5 py-1.5 text-sm font-medium transition disabled:opacity-40 ${active ? "bg-gradient-to-b from-[#2f74e6] to-[#1e63d6] text-white shadow-[0_6px_16px_rgba(30,99,214,.35)]" : "glass-chip text-gray-800"}`}
              >
                {c.name}
                {c.workOnHold ? <span className="ml-1 text-[10px] opacity-80">· hold</span> : null}
              </button>
            );
          })}
        </div>
        <FieldError error={errors.clientId} />
      </div>
      {picked && tax ? (
        <div className="glass space-y-2 rounded-2xl p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{picked.name}</span>
            <TaxBadge tax={tax} />
            {picked.workOnHold ? <span className="rounded-full border border-white/60 bg-red-100/70 px-2 py-0.5 text-[10px] font-semibold text-red-700 backdrop-blur-sm">Work on hold</span> : null}
          </div>
          <div className="text-xs text-gray-600">Place of supply: {tax.placeOfSupply}{picked.gstNumber ? ` · GSTIN ${picked.gstNumber}` : " · unregistered"}</div>
          <ul className="space-y-1 text-xs">
            <li className={picked.email ? "text-gray-700" : "text-amber-700"}>✉️ {picked.email ?? "No email on file — email sending will be disabled"}</li>
            <li className={picked.whatsapp ? "text-gray-700" : "text-amber-700"}>💬 {picked.whatsapp ?? "No WhatsApp number — WhatsApp sending will be disabled"}</li>
          </ul>
          {(picked.country ?? "IN").toUpperCase() === "IN" ? (
          <div className="border-t border-white/60">
            <Toggle
              checked={form.tdsApplicable}
              onChange={(v) => set({ tdsApplicable: v })}
              label="This client will deduct TDS"
              hint={picked.tdsPercent != null ? `${picked.tdsPercent}% on the client card — the payment sheet pre-fills it` : "No TDS % on the client card; you can still enter it when recording the payment"}
            />
          </div>
          ) : null}
          {warnings.length === 2 ? <p className="text-xs font-medium text-red-600">This client has no contact channel; add an email or WhatsApp number before approving.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
