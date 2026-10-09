import { prisma } from "@/lib/db";
import { FULL_INCLUDE, renderInvoiceBuffer } from "@/server/finance/document-core";

export const dynamic = "force-dynamic";

/**
 * Unauthenticated invoice PDF for WhatsApp media (ADR 0005). The token is a 256-bit random value rotated on every
 * approval; the lookup is a unique-index hit, so no constant-time compare is needed. Never indexed, never cached.
 */
const TOKEN = /^[a-f0-9]{64}$/;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN.test(token)) return new Response("Not found", { status: 404 });
  const inv = await prisma.invoice.findUnique({
    where: { publicToken: token },
    include: FULL_INCLUDE,
  });
  if (!inv) return new Response("Not found", { status: 404 });
  const bytes = inv.pdfData && inv.pdfData.length > 0 ? Buffer.from(inv.pdfData) : await renderInvoiceBuffer(inv);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="${inv.number.replace(/[^\w.-]+/g, "_")}.pdf"`,
      "X-Robots-Tag": "noindex, nofollow",
      "Cache-Control": "private, no-store",
    },
  });
}
