import { prisma } from "@/lib/db";
import type { CompanySettings } from "@prisma/client";

let cache: { value: CompanySettings; at: number } | null = null;
const TTL_MS = 10_000;

export async function getSettings(): Promise<CompanySettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const s = await prisma.companySettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  cache = { value: s, at: Date.now() };
  return s;
}

export function invalidateSettingsCache() {
  cache = null;
}
