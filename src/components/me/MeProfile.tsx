"use client";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { Screen, Toggle, WEEKDAYS, minutesToHours, useAdminAction } from "@/components/admin/AdminUi";
import { setNotifyByEmail } from "@/server/admin/me-actions";
import { SignOutSheet } from "@/components/shell/SignOutSheet";
import type { MyProfile } from "@/server/admin/queries";
import { usePush } from "@/components/pwa/usePush";
import { PUSH_COPY } from "@/components/pwa/push-state";

const ROLE_LABEL: Record<MyProfile["role"], string> = {
  ADMIN: "Admin",
  TEAM_LEADER: "Team Leader",
  EXECUTIVE: "Executive",
  HR: "HR",
  CA: "CA (read-only finance)",
};

/** /me — own profile and notification preferences; "Enable push" and "Sign out" sit in the bottom bar (Sign out asks first, the same sheet as the top bar's). */
export function MeProfile({ me, defaultCapacityMinutes, vapidKey }: { me: MyProfile; defaultCapacityMinutes: number; vapidKey: string }) {
  const { busy, run } = useAdminAction();
  const [notify, setNotify] = useState(me.notifyByEmail);
  const push = usePush(vapidKey);
  const [signingOut, setSigningOut] = useState(false);

  const toggleEmail = async (value: boolean) => {
    setNotify(value);
    const res = await run(setNotifyByEmail(value), value ? "Email notifications on" : "Email notifications off");
    if (!res) setNotify(!value);
  };
  const pushLabel = push.busy ? "Enabling…" : PUSH_COPY[push.state].label;
  const pushClickable = push.state === "off" && !push.busy && !busy;
  const zone = (
    <BottomZone
      right={
        <>
          <BarChip label="Enable notifications" active={push.state === "on"} onClick={pushClickable ? () => void push.enable() : undefined}>
            {pushLabel}
          </BarChip>
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setSigningOut(true)}
            className="no-select glass-chip flex h-[30px] items-center whitespace-nowrap rounded-full px-3.5 text-xs font-semibold leading-none text-red-600 outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] dark:text-red-400"
          >
            Sign out
          </button>
        </>
      }
    />
  );

  return (
    <Screen
      header={
        <div className="flex items-center gap-4 bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 py-5 text-white backdrop-blur-xl">
          <Avatar name={me.name} src={me.avatar} size={56} />
          <div className="min-w-0">
            <div className="truncate text-lg font-bold">{me.name}</div>
            <div className="truncate text-xs text-white/80">{me.email}</div>
            <div className="mt-1 inline-block rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-medium backdrop-blur-md">{ROLE_LABEL[me.role]}</div>
          </div>
        </div>
      }
      zone={zone}
    >
      <section className="border-b border-white/60 bg-white/55 px-4 py-3 text-sm backdrop-blur-md">
        <Row label="Team" value={me.team?.name ?? "—"} />
        {me.teamLeader ? <Row label="Reports to" value={me.teamLeader.name} /> : null}
        <Row label="Daily capacity" value={`${minutesToHours(me.dailyCapacityMinutes ?? defaultCapacityMinutes)} h${me.dailyCapacityMinutes == null ? " (company default)" : ""}`} />
        <Row label="Working days" value={me.workingDays.map((d) => WEEKDAYS[d]).join(", ") || "—"} />
      </section>

      <section className="border-b border-white/60 bg-white/55 px-4 py-2 backdrop-blur-md">
        <Toggle label="Email me about task updates" hint="In-app and Chat notifications are always on" checked={notify} onChange={(v) => void toggleEmail(v)} />
        <div className="py-2">
          <span className="block text-sm text-gray-900">Push notifications</span>
          <span className="block text-[11px] text-gray-400">
            {push.error ?? PUSH_COPY[push.state].hint}
          </span>
        </div>
      </section>
      <SignOutSheet open={signingOut} onClose={() => setSigningOut(false)} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{value}</span>
    </div>
  );
}
