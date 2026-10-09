import { can, currentUser } from "@/lib/rbac";
import { loadInvoiceFull, renderInvoiceBuffer } from "@/server/finance/invoice-core";

export const dynamic = "force-dynamic";

/** Streams the stored invoice PDF; drafts are rendered on the fly as a preview. `?download=1` → attachment. ADMIN only. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN" || !can.financeRead(user)) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const inv = await loadInvoiceFull(id);
  if (!inv) return new Response("Not found", { status: 404 });
  const bytes = inv.pdfData && inv.pdfData.length > 0 ? Buffer.from(inv.pdfData) : await renderInvoiceBuffer(inv);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const fileName = `${inv.number.replace(/[^\w.-]+/g, "_")}.pdf`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
