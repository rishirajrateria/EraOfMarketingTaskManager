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
          className="fixed left-0 top-[42%] z-40 flex items-center rounded-r-lg border border-l-0 border-white/35 bg-[rgba(6,48,61,.55)] px-[2px] py-1.5 text-[9.5px] opacity-80 font-semibold tracking-wide text-white backdrop-blur-md [writing-mode:vertical-rl]"
          title={`Demo mode (${user.role.replace("_", " ").toLowerCase()}): switch role`}
          aria-label="Demo mode: switch role"
        >
          Demo ⇄
        </a>
      ) : null}
      <AppFrame user={{ id: user.id, name: user.name ?? "", role: user.role, image: user.image ?? null, email: user.email ?? null }} unread={unread} openRequests={openRequests}>
        {children}
      </AppFrame>
    </ToastProvider>
  );
}
