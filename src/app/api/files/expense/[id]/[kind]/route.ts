import { prisma } from "@/lib/db";
import { can, currentUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** Streams an expense's receipt photo (`kind=receipt`) or voice note (`kind=voice`). ADMIN only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN" || !can.financeRead(user)) return new Response("Forbidden", { status: 403 });
  const { id, kind } = await params;
  if (kind !== "receipt" && kind !== "voice") return new Response("Not found", { status: 404 });
  const e = await prisma.expense.findUnique({
    where: { id },
    select: { receiptImageData: kind === "receipt", receiptImageMime: kind === "receipt", voiceNoteData: kind === "voice" },
  });
  const data = kind === "receipt" ? e?.receiptImageData : e?.voiceNoteData;
  if (!data || data.length === 0) return new Response("Not found", { status: 404 });
  const bytes = Buffer.from(data);
  const mime = kind === "receipt" ? (e?.receiptImageMime ?? "image/jpeg") : "audio/webm";
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": mime, "Content-Length": String(bytes.length), "Content-Disposition": `inline; filename="expense-${id}-${kind}"`, "Cache-Control": "private, max-age=3600" },
  });
}
