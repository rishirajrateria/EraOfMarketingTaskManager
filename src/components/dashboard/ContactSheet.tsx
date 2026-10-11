"use client";
import Link from "next/link";
import { ChevronRight, Mail, Phone } from "lucide-react";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { WhatsAppIcon } from "@/components/shell/TopIcons";
import { MODE_VERB, contactRows, type ContactMode } from "@/components/dashboard/contacts";

const AVATAR: Record<ContactMode, string> = {
  call: "bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)]",
  wa: "bg-[linear-gradient(150deg,#34d399,#059669)]",
  mail: "bg-[linear-gradient(150deg,#f87171,#dc2626)]",
};

/**
 * The card's Call / WhatsApp / Email sheet (prototype `contactSheet`, ADR 0017). Rows by role: Admin → client, Team
 * Leader, executives; Team Leader → Admin + executives; Executive → their Team Leader + Admin. A row without a number /
 * email is greyed; Admin gets "Add number" / "Add email" there.
 */
export function ContactSheet({ task, mode, data, onClose }: { task: TaskRow | null; mode: ContactMode | null; data: DashboardData; onClose: () => void }) {
  if (!task || !mode) return null;
  const rows = contactRows({ mode, viewer: { id: data.me.id, role: data.role, name: data.me.name ?? "" }, company: data.companyName ?? "", tz: data.tz, task, data });
  const verb = MODE_VERB[mode];
  const Icon = mode === "call" ? <Phone size={18} strokeWidth={2.2} /> : mode === "wa" ? <WhatsAppIcon size={18} strokeWidth={2.2} /> : <Mail size={18} strokeWidth={2.2} />;
  const missing = mode === "mail" ? "no email saved" : "no number saved";
  return (
    <Sheet open onClose={onClose} title={`${verb} · ${task.title}`}>
      <ul className="flex flex-col gap-2 px-4 pb-4" aria-label={verb}>
        {rows.length ? null : <li className="px-1 py-3 text-center text-[13px] text-muted">Nobody to contact for this task</li>}
        {rows.map((r) => (
          <li key={r.key}>
            {r.href ? (
              <a
                href={r.href}
                target={mode === "wa" ? "_blank" : undefined}
                rel={mode === "wa" ? "noopener" : undefined}
                onClick={() => setTimeout(onClose, 0)}
                data-contact={r.kind}
                className="touch-target flex w-full items-center gap-3 rounded-[14px] border border-hair bg-glass px-3.5 py-3 text-left backdrop-blur-[22px]"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${AVATAR[mode]}`} aria-hidden>
                  {Icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-[15px] font-semibold">{r.label}</b>
                  <small className="truncate text-[12px] text-muted">
                    {r.name} · {r.detail}
                  </small>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
              </a>
            ) : (
              <div className="flex w-full items-center gap-3 rounded-[14px] border border-hair bg-glass px-3.5 py-3" data-contact={r.kind}>
                <span className="flex min-w-0 flex-1 flex-col opacity-55" aria-disabled>
                  <b className="text-[15px] font-semibold">{r.label}</b>
                  <small className="truncate text-[12px] text-muted">
                    {r.name || "—"} · {missing}
                  </small>
                </span>
                {r.addHref ? (
                  <Link href={r.addHref} onClick={onClose} className="glass-chip flex h-[30px] shrink-0 items-center rounded-full border border-hair px-3 text-[12.5px] font-semibold text-ink">
                    {mode === "mail" ? "Add email" : "Add number"}
                  </Link>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
