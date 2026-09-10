import { prisma } from "@/lib/db";
import { can, currentUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** Streams a stored receipt PDF for a payment id. ADMIN / CA only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!can.financeRead(user)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const p = await prisma.payment.findUnique({ where: { id }, select: { receiptNumber: true, receiptPdfData: true } });
  if (!p?.receiptPdfData || p.receiptPdfData.length === 0) return new Response("Not found", { status: 404 });
  const bytes = Buffer.from(p.receiptPdfData);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${p.receiptNumber ?? "receipt"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
