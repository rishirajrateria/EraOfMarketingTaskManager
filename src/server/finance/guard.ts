import { redirect } from "next/navigation";
import { can, currentUser, type SessionUser } from "@/lib/rbac";

/**
 * Page-level guard for finance screens: ADMIN only (SPEC §11). Accountant access is not enabled — Admin shares
 * exports by hand — so the role is checked directly in addition to the capability matrix.
 */
export async function requireFinancePage(): Promise<SessionUser & { canWrite: boolean }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN" || !can.financeRead(user)) redirect("/");
  return { ...user, canWrite: can.financeWrite(user) };
}
