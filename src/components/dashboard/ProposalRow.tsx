"use client";
import { Info, Mail, Phone } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { fmtMinutes } from "@/lib/time";
import type { DashboardData, TaskRow as Row } from "@/server/tasks/types";
import { useLongPress } from "@/components/ui/useLongPress";
import { teamChipLabel } from "@/components/dashboard/format";
import { IconBtn, stop } from "@/components/dashboard/RowParts";
import { WhatsAppIcon } from "@/components/shell/TopIcons";
import { personChip, proposalDatePill } from "@/components/dashboard/proposal-ui";
import type { RowHandlers } from "@/components/dashboard/TaskRow";

const CHIP_SHAPE = "inline-block h-[22px] min-w-0 max-w-[150px] shrink truncate rounded-full px-[9px] text-[11.5px] font-medium leading-[22px]";
export const CHIP = `glass-chip ${CHIP_SHAPE} text-ink`;
export const TEAM_CHIP = `${CHIP_SHAPE} border border-hair bg-team-bg text-team`;
/** Admin's person chip (prototype `.chip.person`): the assignee's first name in teal. */
export const PERSON_CHIP = `glass-chip ${CHIP_SHAPE} font-semibold text-team`;
const PILL = "inline-flex h-[24px] shrink-0 items-center rounded-full border border-hair bg-chip px-2 text-[11.5px] leading-none text-ink";
/** The proposal bar's pills (prototype `.pill.act`). */
const ACT = "no-select inline-flex h-7 items-center rounded-full border px-[11px] text-[12px] font-semibold";

/**
 * A Team Leader's proposal on the dashboard (ADR 0021, prototype `.row.proposal`): the TL sees it dashed grey with
 * "Waiting for Admin"; Admin sees it indigo with "Proposal" and the Approve / Edit & approve / Reject… pills. It holds no
 * time — the pills show the requested day and "no time held"; no Drive / Meet / Chat icons, a dashed inert circle.
 * Long-press opens the proposal menu (Admin: decide · the TL: withdraw).
 */
export function ProposalRow({ t, data, h }: { t: Row; data: DashboardData; h: RowHandlers }) {
  const press = useLongPress(() => h.onLongPress(t), () => h.onOpen(t));
  const admin = data.role === "ADMIN";
  const team = teamChipLabel(t.teams);
  const person = admin ? personChip(t, data.people) : "";
  const act = (fn?: (t: Row) => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.(t);
  };
  return (
    <li
      {...press}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          h.onLongPress(t);
        }
      }}
      className={clsx("no-select task-card proposal", admin && "adm")}
      data-task-id={t.id}
      data-proposal
      aria-label={`${t.title} · ${admin ? "proposal" : "waiting for Admin"}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-1.5 pt-1">
          <span className="line-clamp-2 min-w-0 text-[15px] font-[650] leading-5 tracking-[-.01em] text-ink">{t.title}</span>
          <span className="prop-tag mt-[1px]">{admin ? "Proposal" : "Waiting for Admin"}</span>
        </div>
        <button
          type="button"
          disabled
          aria-label="Waiting for Admin"
          title="Waiting for Admin"
          className="h-8 w-8 shrink-0 cursor-default rounded-full border-2 border-dashed border-ink bg-chip opacity-45"
        />
      </div>

      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className={CHIP}>{t.client.name}</span>
          {team ? <span className={TEAM_CHIP}>{team}</span> : null}
          {person ? (
            <span className={PERSON_CHIP} title={`Proposed by ${person}`}>
              {person}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className={PILL}>{proposalDatePill(t)}</span>
          <span className={clsx(PILL, "font-bold")}>{t.deadlineOnly ? "Deadline" : fmtMinutes(t.allocatedMinutes)}</span>
        </div>
      </div>

      <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
        <div className="-ml-1.5 flex min-w-0 flex-[1_1_auto] items-center">
          <IconBtn label="Task details" onClick={() => h.onOpen(t)}>
            <Info size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Call" onClick={() => h.onContact(t, "call")}>
            <Phone size={18} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="WhatsApp" onClick={() => h.onContact(t, "wa")}>
            <WhatsAppIcon size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Email" onClick={() => h.onContact(t, "mail")}>
            <Mail size={18} strokeWidth={1.75} />
          </IconBtn>
        </div>
        <span className={clsx(PILL, "text-muted")}>no time held</span>
      </div>

      {admin ? (
        <div className="mt-2 flex flex-wrap gap-1.5" onPointerDown={stop} onPointerUp={stop}>
          <button type="button" className={clsx(ACT, "border-transparent bg-[#16a34a] text-white")} onClick={act(h.onApprove)}>
            Approve
          </button>
          <button type="button" className={clsx(ACT, "glass-chip border-hair text-ink")} onClick={act(h.onEditApprove)}>
            Edit &amp; approve
          </button>
          <button type="button" className={clsx(ACT, "glass-chip border-hair text-[#dc2626] dark:text-red-400")} onClick={act(h.onReject)}>
            Reject…
          </button>
        </div>
      ) : null}
    </li>
  );
}
