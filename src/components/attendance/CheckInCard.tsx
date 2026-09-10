"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkIn, checkOut } from "@/server/attendance/actions";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { STATUS_STYLE } from "@/components/attendance/status";

export type TodayRow = { status: "PRESENT" | "ABSENT" | "HALF_DAY" | "LEAVE" | "HOLIDAY"; checkIn: string | null; checkOut: string | null } | null;

export function CheckInCard({ dateLabel, today }: { dateLabel: string; today: TodayRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [row, setRow] = useState(today);

  const run = (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast(r.error, "err");
      toast(okText);
      setRow((prev) => prev ?? { status: "PRESENT", checkIn: null, checkOut: null });
      router.refresh();
    });

  const style = row ? STATUS_STYLE[row.status] : null;
  return (
    <section className="mx-3 mt-3 rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500">Today · {dateLabel}</div>
          <div className="mt-0.5 text-sm">
            {row ? (
              <>
                <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-semibold ${style?.cls}`}>{style?.label}</span>
                in {row.checkIn ?? "--:--"} · out {row.checkOut ?? "--:--"}
              </>
            ) : (
              <span className="text-gray-500">Not checked in yet</span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button className={btnPrimary} disabled={pending || !!row?.checkIn} onClick={() => run(checkIn, "Checked in")}>
          Check in
        </button>
        <button className={btnSecondary} disabled={pending || !row?.checkIn} onClick={() => run(checkOut, "Checked out")}>
          Check out
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">Checking in after 2:00pm counts as a half day.</p>
    </section>
  );
}
