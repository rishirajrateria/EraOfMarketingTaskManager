import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";

/** Old inbox URL (SPEC §10): Admin's inbox moved to /admin/requests (ADR 0016); HR keeps the leave inbox. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ all?: string; tab?: string }> }) {
  const user = await requireUser();
  if (user.role === "HR") redirect("/requests/leave");
  if (user.role !== "ADMIN") redirect("/dashboard");
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.tab) q.set("tab", sp.tab);
  if (sp.all === "1") q.set("all", "1");
  redirect(`/admin/requests${q.size ? `?${q}` : ""}`);
}
