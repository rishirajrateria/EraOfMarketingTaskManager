import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
  ],
};

export default nextConfig;
