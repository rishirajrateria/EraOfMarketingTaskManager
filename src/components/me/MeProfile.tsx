"use client";
import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { btnSecondary } from "@/components/ui/Field";
import { Toggle, WEEKDAYS, minutesToHours, useAdminAction } from "@/components/admin/AdminUi";
import { setNotifyByEmail } from "@/server/admin/me-actions";
import type { MyProfile } from "@/server/admin/queries";

declare global {
  interface Window {
    /** Registered by the PWA push module; enables web-push for the current user. */
    __eomEnablePush?: () => Promise<void> | void;
  }
}

const ROLE_LABEL: Record<MyProfile["role"], string> = {
  ADMIN: "Admin",
  TEAM_LEADER: "Team Leader",
  EXECUTIVE: "Executive",
  HR: "HR",
  CA: "CA (read-only finance)",
};

/** /me — own profile, notification preferences and sign-out. */
export function MeProfile({ me, defaultCapacityMinutes }: { me: MyProfile; defaultCapacityMinutes: number }) {
  const { busy, run } = useAdminAction();
  const [notify, setNotify] = useState(me.notifyByEmail);
  const [pushState, setPushState] = useState<"idle" | "busy" | "done" | "unavailable">("idle");

  const toggleEmail = async (value: boolean) => {
    setNotify(value);
    const res = await run(setNotifyByEmail(value), value ? "Email notifications on" : "Email notifications off");
    if (!res) setNotify(!value);
  };
  const enablePush = async () => {
    if (typeof window.__eomEnablePush !== "function") {
      setPushState("unavailable");
      return;
    }
    setPushState("busy");
    try {
      await window.__eomEnablePush();
      setPushState("done");
    } catch {
      setPushState("idle");
    }
  };

  return (
    <div className="flex flex-1 flex-col pb-10">
      <div className="flex items-center gap-4 bg-brand-blue px-4 py-5 text-white">
        <Avatar name={me.name} src={me.avatar} size={56} />
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{me.name}</div>
          <div className="truncate text-xs text-white/80">{me.email}</div>
          <div className="mt-1 inline-block rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-medium">{ROLE_LABEL[me.role]}</div>
        </div>
      </div>

      <section className="border-b bg-white px-4 py-3 text-sm">
        <Row label="Team" value={me.team?.name ?? "—"} />
        {me.teamLeader ? <Row label="Reports to" value={me.teamLeader.name} /> : null}
        <Row label="Daily capacity" value={`${minutesToHours(me.dailyCapacityMinutes ?? defaultCapacityMinutes)} h${me.dailyCapacityMinutes == null ? " (company default)" : ""}`} />
        <Row label="Working days" value={me.workingDays.map((d) => WEEKDAYS[d]).join(", ") || "—"} />
      </section>

      <section className="border-b bg-white px-4 py-2">
        <Toggle label="Email me about task updates" hint="In-app and Chat notifications are always on" checked={notify} onChange={(v) => void toggleEmail(v)} />
        <div className="flex items-center justify-between gap-3 py-2">
          <span>
            <span className="block text-sm text-gray-900">Push notifications</span>
            <span className="block text-[11px] text-gray-400">
              {pushState === "done" ? "Enabled on this device" : pushState === "unavailable" ? "Not available in this browser yet" : "Get alerts even when the app is closed"}
            </span>
          </span>
          <button type="button" className={btnSecondary} disabled={busy || pushState === "busy" || pushState === "done"} onClick={() => void enablePush()}>
            {pushState === "busy" ? "Enabling…" : "Enable"}
          </button>
        </div>
      </section>

      <div className="px-4 py-4">
        <Link href="/api/auth/signout" className="block rounded-lg border border-red-200 bg-white px-4 py-3 text-center text-sm font-medium text-red-600">
          Sign out
        </Link>
      </div>
    </div>
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
