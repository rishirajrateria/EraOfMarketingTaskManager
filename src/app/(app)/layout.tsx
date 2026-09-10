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
  return (
    <ToastProvider>
      <AppFrame user={{ id: user.id, name: user.name ?? "", role: user.role, image: user.image ?? null }} unread={unread} openRequests={openRequests}>
        {children}
      </AppFrame>
    </ToastProvider>
  );
}
