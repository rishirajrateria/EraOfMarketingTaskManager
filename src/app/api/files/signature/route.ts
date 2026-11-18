import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/rbac";
import { sniffImageMime } from "@/lib/image-mime";

export const dynamic = "force-dynamic";

/** Streams the signature image stored in CompanySettings.signatureData (ADR 0007). Signed-in users only. */
export async function GET() {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const s = await prisma.companySettings.findUnique({ where: { id: "default" }, select: { signatureData: true, updatedAt: true } });
  if (!s?.signatureData || s.signatureData.length === 0) return new Response("No signature", { status: 404 });
  const bytes = Buffer.from(s.signatureData);
  return new Response(bytes, {
    headers: {
      "Content-Type": sniffImageMime(bytes),
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=60",
      "Last-Modified": s.updatedAt.toUTCString(),
    },
  });
}
