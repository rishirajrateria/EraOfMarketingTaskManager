"use client";
import { TopBar, type TopBarUser } from "@/components/shell/TopBar";

export type { TopBarUser };

/** The shared top bar (ADR 0016) inside the dashboard's cyan summary. */
export function DashboardTopBar({ user, unread, openRequests }: { user: TopBarUser; unread: number; openRequests: number }) {
  return <TopBar user={user} unread={unread} openRequests={openRequests} />;
}
