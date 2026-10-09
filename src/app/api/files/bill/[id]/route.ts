import { prisma } from "@/lib/db";
import { can, currentUser } from "@/lib/rbac";
import { safeMime } from "@/lib/sanitize";

export const dynamic = "force-dynamic";

/** Streams the vendor bill attached to a bill payment (ExpenseOccurrence id). `?download=1` → attachment. ADMIN only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN" || !can.financeRead(user)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const o = await prisma.expenseOccurrence.findUnique({ where: { id }, select: { billData: true, billMime: true, billName: true } });
  if (!o?.billData || o.billData.length === 0) return new Response("Not found", { status: 404 });
  const bytes = Buffer.from(o.billData);
  const mime = safeMime(o.billMime);
  const name = (o.billName ?? "bill").replace(/[^\w.-]+/g, "_");
  const download = new URL(req.url).searchParams.get("download") === "1" || mime === "application/octet-stream";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=600",
    },
  });
}
