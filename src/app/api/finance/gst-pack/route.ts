import { can, currentUser } from "@/lib/rbac";
import { buildGstPack } from "@/server/finance/gst-pack";

export const dynamic = "force-dynamic";

/** GET /api/finance/gst-pack?month=YYYY-MM → ZIP of that month's claimable expense bills + summary.csv (ADR 0009). ADMIN only. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "ADMIN" || !can.financeRead(user)) return new Response("Forbidden", { status: 403 });
  const month = new URL(req.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new Response("month must be yyyy-MM", { status: 400 });
  const pack = await buildGstPack(month);
  return new Response(new Uint8Array(pack.zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(pack.zip.length),
      "Content-Disposition": `attachment; filename="${pack.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
