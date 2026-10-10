"use client";
import Link from "next/link";
import { ChevronRight, Phone } from "lucide-react";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { WhatsAppIcon } from "@/components/shell/TopIcons";
import { contactRows, taskContacts, type ContactMode } from "@/components/dashboard/contacts";

/**
 * The card's Call / WhatsApp sheet (prototype `contactSheet`, ADR 0017): call or WhatsApp the client or the task's Team
 * Leader (a Team Leader gets the Admin instead). Rows without a number are greyed "no number saved".
 */
export function ContactSheet({ task, mode, data, onClose }: { task: TaskRow | null; mode: ContactMode | null; data: DashboardData; onClose: () => void }) {
  if (!task || !mode) return null;
  const rows = contactRows({ mode, viewerRole: data.role, taskTitle: task.title, ...taskContacts(task, data) });
  const Icon = mode === "call" ? <Phone size={18} strokeWidth={2.2} /> : <WhatsAppIcon size={18} strokeWidth={2.2} />;
  return (
    <Sheet open onClose={onClose} title={`${mode === "call" ? "Call" : "WhatsApp"} · ${task.title}`}>
      <ul className="flex flex-col gap-2 px-4 pb-4" aria-label={mode === "call" ? "Call" : "WhatsApp"}>
        {rows.map((r) => (
          <li key={r.key}>
            {r.href ? (
              <a
                href={r.href}
                target={mode === "wa" ? "_blank" : undefined}
                rel={mode === "wa" ? "noopener" : undefined}
                onClick={() => setTimeout(onClose, 0)}
                className="touch-target flex w-full items-center gap-3 rounded-[14px] border border-hair bg-glass px-3.5 py-3 text-left backdrop-blur-[22px]"
              >
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${mode === "call" ? "bg-[var(--n-blue)]" : "bg-[#16a34a]"}`} aria-hidden>
                  {Icon}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="text-[15px] font-semibold">{r.label}</b>
                  <small className="truncate text-[12px] text-muted">
                    {r.name} · {r.number}
                  </small>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
              </a>
            ) : (
              <div className="flex w-full items-center gap-3 rounded-[14px] border border-hair bg-glass px-3.5 py-3">
                <span className="flex min-w-0 flex-1 flex-col opacity-55" aria-disabled>
                  <b className="text-[15px] font-semibold">{r.label}</b>
                  <small className="truncate text-[12px] text-muted">{r.name || "—"} · no number saved</small>
                </span>
                {r.addHref ? (
                  <Link href={r.addHref} onClick={onClose} className="glass-chip flex h-[30px] shrink-0 items-center rounded-full border border-hair px-3 text-[12.5px] font-semibold text-ink">
                    Add number
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
