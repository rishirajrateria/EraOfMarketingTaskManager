import { loadInvoiceFull, renderInvoiceBuffer } from "@/server/finance/document-core";
import { contentDisposition, invoiceFileName } from "@/server/finance/file-names";
import { portalInvoiceId } from "@/server/portal/portal";

export const dynamic = "force-dynamic";

const PRIVATE = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/**
 * Invoice PDF from a client tracking link (no login): only an issued invoice of the client that owns `token` — any
 * other id (another client's, a draft, one awaiting approval, a cancelled one) is a plain 404. Never indexed or cached.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const invoiceId = await portalInvoiceId(token, id);
  const inv = invoiceId ? await loadInvoiceFull(invoiceId) : null;
  if (!inv) return new Response("Not found", { status: 404, headers: PRIVATE });
  const bytes = inv.pdfData && inv.pdfData.length > 0 ? Buffer.from(inv.pdfData) : await renderInvoiceBuffer(inv);
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...PRIVATE,
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition("attachment", invoiceFileName(inv)),
    },
  });
}
