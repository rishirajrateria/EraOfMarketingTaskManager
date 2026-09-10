import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight gate: unauthenticated users are redirected to /login. Role checks happen server-side in
 * every page/action (SPEC §14) — this middleware only checks the session cookie exists.
 */
const PUBLIC = ["/login", "/api/auth", "/api/jobs", "/manifest.webmanifest", "/sw.js", "/icons", "/offline"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p)) || pathname.startsWith("/_next")) return NextResponse.next();
  const hasSession =
    req.cookies.has("authjs.session-token") || req.cookies.has("__Secure-authjs.session-token");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
