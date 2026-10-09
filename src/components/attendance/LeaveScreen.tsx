"use client";
import { useState } from "react";
import type { LeaveSummary } from "@/server/leave/queries";
import { Sheet } from "@/components/ui/Sheet";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { LeaveForm } from "@/components/attendance/LeaveForm";
import { LeaveList } from "@/components/attendance/LeaveList";

/** /leave — own leaves in the middle; "+ Request leave" in the bottom bar opens the form as a sheet. */
export function LeaveScreen({ leaves, defaultDate, isAdmin }: { leaves: LeaveSummary[]; defaultDate: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const pending = leaves.filter((l) => l.status === "REQUESTED").length;
  const zone = (
    <BottomZone
      menu={isAdmin}
      right={
        <BarChip label="Request leave" onClick={() => setOpen(true)}>
          + Request leave
        </BarChip>
      }
    />
  );
  return (
    <Screen header={<ScreenHeader title="Leave" subtitle={`${leaves.length} leave${leaves.length === 1 ? "" : "s"} · ${pending} pending HR`} />} zone={zone}>
      <h2 className="mx-4 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">My leaves</h2>
      <div className="pb-3">
        <LeaveList leaves={leaves} />
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Request leave">
        {open ? <LeaveForm defaultDate={defaultDate} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} /> : null}
      </Sheet>
    </Screen>
  );
}
