import { redirect } from "next/navigation";
import { can, currentUser, type SessionUser } from "@/lib/rbac";

/** Page-level guard for finance screens: ADMIN or the read-only CA role (SPEC §2, §11.4). */
export async function requireFinancePage(): Promise<SessionUser & { canWrite: boolean }> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!can.financeRead(user)) redirect("/");
  return { ...user, canWrite: can.financeWrite(user) };
}
