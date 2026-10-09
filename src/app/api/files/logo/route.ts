import { prisma } from "@/lib/db";
import { sniffImageMime } from "@/lib/image-mime";

export const dynamic = "force-dynamic";

/** Streams the company logo stored in CompanySettings.logoData (SPEC §11.9). */
export async function GET() {
  const s = await prisma.companySettings.findUnique({ where: { id: "default" }, select: { logoData: true, updatedAt: true } });
  if (!s?.logoData || s.logoData.length === 0) return new Response("No logo", { status: 404 });
  const bytes = Buffer.from(s.logoData);
  return new Response(bytes, {
    headers: {
      "Content-Type": sniffImageMime(bytes),
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=60",
      "Last-Modified": s.updatedAt.toUTCString(),
    },
  });
}
