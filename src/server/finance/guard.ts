import { redirect } from "next/navigation";
import { can, currentUser, requireUser, ForbiddenError, type SessionUser } from "@/lib/rbac";

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

/** Server-action guard for finance data (ADMIN only): "write" changes the books, "read" views / exports them. */
export async function requireFinanceActor(mode: "read" | "write" = "write"): Promise<SessionUser> {
  const user = await requireUser();
  const allowed = mode === "write" ? can.financeWrite(user) : can.financeRead(user);
  if (user.role !== "ADMIN" || !allowed) throw new ForbiddenError(mode === "write" ? "Only Admin can change finance records" : "Finance access required");
  return user;
}
