import { headers } from "next/headers";
import { publicBaseUrl } from "@/server/finance/links";

/** Absolute base URL for links sent outside the app: PUBLIC_BASE_URL / AUTH_URL / NEXTAUTH_URL, else this request's host. */
export async function portalBaseUrl(): Promise<string> {
  const configured = publicBaseUrl() || (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
  } catch {
    /* outside a request (tests) */
  }
  return "";
}
