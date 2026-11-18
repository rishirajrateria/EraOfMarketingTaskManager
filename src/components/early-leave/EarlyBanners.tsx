"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import type { BackQuestion, EarlyBanner } from "@/server/early-leave/queries";
import { answerBackToday } from "@/server/early-leave/actions";
import { earlyLeftPhrase } from "@/lib/notification-text";
import { useToast } from "@/components/ui/Toast";
import { ShiftAllSheet } from "@/components/early-leave/ShiftAllSheet";

const smallBtn = "inline-flex h-9 items-center justify-center rounded-xl px-3 text-[13px] font-semibold disabled:opacity-45";

/**
 * The sticky "<Name> left early · N tasks need shifting" banners (ADR 0022, prototype `shiftBanners`). Admin gets
 * "Shift all to next free slots" (confirm sheet) and "Shift manually" (the dashboard filtered to the flagged tasks);
 * HR reads "Admin will shift these". Only banners with flagged tasks show.
 */
export function EarlyBanners({
  banners,
  canShift,
  tz,
  manualId = null,
  onManual,
}: {
  banners: EarlyBanner[];
  canShift: boolean;
  tz: string;
  /** The banner whose tasks the dashboard is filtered to ("Show all tasks" then). */
  manualId?: string | null;
  /** "Shift manually"; default: open the dashboard filtered to them. */
  onManual?: (id: string | null) => void;
}) {
  const router = useRouter();
  const [shiftId, setShiftId] = useState<string | null>(null);
  const shown = banners.filter((b) => b.taskIds.length > 0);
  if (!shown.length) return null;
  const manual = onManual ?? ((id: string | null) => router.push(id ? `/dashboard?shift=${id}` : "/dashboard"));
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-2.5 pb-0.5 pt-2" data-shift-banner>
      {shown.map((b) => (
        <div key={b.id} className="sbanner" role="status">
          <div className="flex items-start gap-2.5">
            <span className="sbic" aria-hidden>
              <Clock size={15} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <b className="block text-[13.5px] leading-tight">{earlyLeftPhrase(b.name, b.taskIds.length)}</b>
              <small className="block text-[11.5px] opacity-85">{b.detail}</small>
            </div>
          </div>
          {canShift ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" className={`${smallBtn} bg-[var(--shift)] text-white`} onClick={() => setShiftId(b.id)}>
                Shift all to next free slots
              </button>
              <button type="button" className={`${smallBtn} border border-[var(--ban-bd)] bg-transparent text-[var(--ban-fg)]`} onClick={() => manual(manualId === b.id ? null : b.id)}>
                {manualId === b.id ? "Show all tasks" : "Shift manually"}
              </button>
            </div>
          ) : (
            <p className="mt-1.5 text-[12px] font-semibold">Admin will shift these</p>
          )}
        </div>
      ))}
      {canShift ? <ShiftAllSheet banner={shown.find((b) => b.id === shiftId) ?? null} tz={tz} onClose={() => setShiftId(null)} /> : null}
    </div>
  );
}

/** "Is <Name> back today?" cards (prototype `backPromptCards`): Still off / Back. Admin and HR. */
export function BackQuestionCards({ questions }: { questions: BackQuestion[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  if (!questions.length) return null;
  const answer = (q: BackQuestion, back: boolean) =>
    start(async () => {
      const r = await answerBackToday(q.id, back);
      if (!r.ok) return void toast(r.error, "err");
      const first = q.name.split(" ")[0];
      toast(back ? `${first} is back today` : `Still off · asking again tomorrow morning${r.data.flagged ? ` · ${r.data.flagged} to shift` : ""}`);
      router.refresh();
    });
  return (
    <div className="flex flex-col gap-2 px-3 pt-3">
      {questions.map((q) => (
        <div key={q.id} role="group" aria-label={`Is ${q.name.split(" ")[0]} back today?`} className="card-bq rounded-[18px] border border-hair bg-glass px-3.5 py-3 shadow-[var(--shadow)]">
          <div className="text-[15px] font-bold">Is {q.name.split(" ")[0]} back today?</div>
          <small className="mb-2 mt-0.5 block text-[12px] text-muted">{q.text}</small>
          <div className="flex gap-2">
            <button type="button" disabled={pending} className={`${smallBtn} flex-1 border border-hair bg-chip text-ink`} onClick={() => answer(q, false)}>
              Still off
            </button>
            <button type="button" disabled={pending} className={`${smallBtn} flex-1 bg-[#16a34a] text-white`} onClick={() => answer(q, true)}>
              Back
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
