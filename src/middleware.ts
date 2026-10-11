import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight gate: unauthenticated users are redirected to /login. Role checks happen server-side in
 * every page/action (SPEC §14) — this middleware only checks the session cookie exists.
 * `/c/<token>` is a client's tracking link: public by design (the 128-bit token is the key), never indexed.
 */
const PUBLIC = ["/login", "/api/auth", "/api/jobs", "/manifest.webmanifest", "/sw.js", "/icons", "/offline"];
const CLIENT_LINK_PREFIX = "/c/";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith(CLIENT_LINK_PREFIX)) {
    const res = NextResponse.next();
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    res.headers.set("Referrer-Policy", "no-referrer");
    return res;
  }
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
