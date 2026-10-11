import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { getMyProfile } from "@/server/admin/queries";
import { MeProfile } from "@/components/me/MeProfile";

/** Own profile: name, avatar, role, team, notification toggle, push enable, sign-out. */
export default async function MePage() {
  const user = await requireUser();
  const [me, settings] = await Promise.all([getMyProfile(user.id), getSettings()]);
  if (!me) redirect("/login");
  const defaultCapacity = settings.workEndMinutes - settings.workStartMinutes - (settings.lunchEndMinutes - settings.lunchStartMinutes);
  return <MeProfile me={me} defaultCapacityMinutes={defaultCapacity} />;
}
