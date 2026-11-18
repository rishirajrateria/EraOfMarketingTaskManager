import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "@/lib/rbac";

/** Page-level guard for the Admin-only screens (SPEC §2; the menu tray itself is gone, its pages are reached from the top bar, the bottom nav and the dashboards). */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return user;
}
