import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { env } from "@/lib/env";
import { JOBS, runJob, type JobName } from "@/jobs/registry";
import { currentUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Vercel Cron → GET /api/jobs/<name> with Authorization: Bearer CRON_SECRET. Admins may trigger manually. */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!(name in JOBS)) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const secretOk =
    !!env.cronSecret && bearer.length === env.cronSecret.length && timingSafeEqual(Buffer.from(bearer), Buffer.from(env.cronSecret));
  const authorized = secretOk || (await currentUser())?.role === "ADMIN";
  if (!authorized) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await runJob(name as JobName);
  return NextResponse.json({ job: name, result });
}

export const POST = GET;
