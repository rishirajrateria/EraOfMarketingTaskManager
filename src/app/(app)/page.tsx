import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";

export default async function Home() {
  const user = await requireUser();
  if (user.role === "HR") redirect("/attendance");
  if (user.role === "CA") redirect("/me"); // CA access is parked (ADR 0004)
  redirect("/dashboard");
}
