import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/rbac";
import { canView } from "@/server/tasks/queries";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const a = await prisma.taskAttachment.findUnique({ where: { id } });
  if (!a || !(await canView(user, a.taskId))) return new Response("Not found", { status: 404 });
  if (!a.data) return a.url ? Response.redirect(a.url) : new Response("No data", { status: 404 });
  return new Response(new Uint8Array(a.data), {
    headers: { "Content-Type": a.mimeType ?? "application/octet-stream", "Content-Disposition": `inline; filename="${a.name}"`, "Cache-Control": "private, max-age=3600" },
  });
}
