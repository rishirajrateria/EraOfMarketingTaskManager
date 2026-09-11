import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/rbac";
import { canView } from "@/server/tasks/queries";
import { safeMime } from "@/lib/sanitize";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const a = await prisma.taskAttachment.findUnique({ where: { id } });
  if (!a || !(await canView(user, a.taskId))) return new Response("Not found", { status: 404 });
  if (!a.data) return a.url ? Response.redirect(a.url) : new Response("No data", { status: 404 });
  const mime = safeMime(a.mimeType);
  const inline = mime !== "application/octet-stream";
  const name = a.name.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(a.data), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; media-src 'self'; img-src 'self'",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
