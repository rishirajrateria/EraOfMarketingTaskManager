import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";

export default async function Home() {
  const user = await requireUser();
  if (user.role === "HR") redirect("/attendance");
  if (user.role === "CA") redirect("/admin/finance");
  redirect("/dashboard");
}
