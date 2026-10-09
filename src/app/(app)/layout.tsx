import { redirect } from "next/navigation";
import { currentUser } from "@/lib/rbac";
import { AppFrame } from "@/components/shell/AppFrame";
import { ToastProvider } from "@/components/ui/Toast";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const [unread, openRequests] = await Promise.all([
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    user.role === "ADMIN"
      ? prisma.request.count({ where: { status: "OPEN", targetRole: "ADMIN" } })
      : user.role === "HR"
        ? prisma.request.count({ where: { status: "OPEN", targetRole: "HR" } })
        : Promise.resolve(0),
  ]);
  const demo = process.env.DEMO_LOGIN === "true";
  return (
    <ToastProvider>
      {demo ? (
        <a
          href="/login?switch=1"
          className="fixed left-1/2 top-2 z-40 flex h-[22px] -translate-x-1/2 items-center rounded-full border border-white/35 bg-[rgba(6,48,61,.35)] px-2.5 text-[10.5px] font-semibold text-white backdrop-blur-md"
          title="Demo mode: switch role"
        >
          Demo · {user.role.replace("_", " ").toLowerCase()} · switch
        </a>
      ) : null}
      <AppFrame user={{ id: user.id, name: user.name ?? "", role: user.role, image: user.image ?? null }} unread={unread} openRequests={openRequests}>
        {children}
      </AppFrame>
    </ToastProvider>
  );
}
