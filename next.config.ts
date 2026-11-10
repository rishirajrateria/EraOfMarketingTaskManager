import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers (ADR 0020). Deliberately NO script-src CSP: Next injects inline scripts for hydration, and a strict
 * policy would break the app. frame-ancestors alone blocks clickjacking. The microphone stays on (self) because voice
 * notes (VoiceRecorder) and dictation use it; camera and geolocation are off.
 */
const baseSecurity = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pdfkit", "googleapis", "@prisma/client", "web-push"],
  // Fonts embedded in invoice PDFs are read from disk at runtime; keep them in a standalone / traced build too.
  outputFileTracingIncludes: { "/**/*": ["./src/server/finance/fonts/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    // Everything except a client's tracking link gets the standard referrer policy; /c/* keeps no-referrer (its token is the secret).
    { source: "/((?!c/).*)", headers: [...baseSecurity, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }] },
    { source: "/c/:path*", headers: [...baseSecurity, { key: "Referrer-Policy", value: "no-referrer" }] },
  ],
};

export default nextConfig;
