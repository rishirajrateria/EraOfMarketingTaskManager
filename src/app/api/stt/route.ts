import { NextResponse } from "next/server";
import { currentUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Speech-to-text fallback for browsers without the Web Speech API.
 * POST multipart { file, lang? } → { text }. Forwards the audio to STT_PROVIDER_URL (optional STT_PROVIDER_KEY
 * sent as a Bearer token); returns 501 when no provider is configured.
 */
export async function POST(req: Request) {
  const providerUrl = process.env.STT_PROVIDER_URL;
  if (!providerUrl) return NextResponse.json({ error: "STT not configured" }, { status: 501 });
  if (!(await currentUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "No audio file" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Audio larger than 10 MB" }, { status: 413 });

  const upstream = new FormData();
  upstream.append("file", file, file.name || "audio.webm");
  const lang = form?.get("lang");
  if (typeof lang === "string" && lang) upstream.append("language", lang);

  const headers: Record<string, string> = {};
  if (process.env.STT_PROVIDER_KEY) headers.authorization = `Bearer ${process.env.STT_PROVIDER_KEY}`;

  try {
    const res = await fetch(providerUrl, { method: "POST", headers, body: upstream });
    if (!res.ok) return NextResponse.json({ error: `STT provider responded ${res.status}` }, { status: 502 });
    const json = (await res.json().catch(() => ({}))) as { text?: string; transcript?: string };
    return NextResponse.json({ text: json.text ?? json.transcript ?? "" });
  } catch {
    return NextResponse.json({ error: "STT provider unreachable" }, { status: 502 });
  }
}
