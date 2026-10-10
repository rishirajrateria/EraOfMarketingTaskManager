"use client";
import { TopBar, type TopBarUser } from "@/components/shell/TopBar";

export type { TopBarUser };

/** The shared top bar (ADR 0016) inside the dashboard's cyan summary: ☰ (Admin) and the app shortcuts. */
export function DashboardTopBar({ user }: { user: TopBarUser }) {
  return <TopBar user={user} />;
}
