import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Guess an image MIME type from magic bytes (the logo is stored without its content type). */
function sniffImageMime(b: Uint8Array): string {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  const head = Buffer.from(b.subarray(0, 256)).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}

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
