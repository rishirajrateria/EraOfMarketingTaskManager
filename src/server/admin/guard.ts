import { redirect } from "next/navigation";
import { currentUser, type SessionUser } from "@/lib/rbac";

/** Page-level guard for the Admin menu-tray screens (SPEC §2 "Menu tray: Admin only"). */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");
  return user;
}
