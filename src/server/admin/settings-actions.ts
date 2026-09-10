"use server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { invalidateSettingsCache } from "@/lib/settings";
import { safeRevalidate } from "@/lib/revalidate";
import { parseDateKey } from "@/lib/time";
import { parse, settingsInputSchema } from "@/server/admin/schemas";
import type { CompanySettings } from "@prisma/client";

/** Company settings actions (SPEC §11.9). ADMIN-only; every save is audited and busts the settings cache. */

const SETTINGS_PATH = "/admin/settings";
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** Audit snapshot without the binary logo. */
function snapshot(s: CompanySettings) {
  const { logoData: _logo, ...rest } = s;
  return { ...rest, defaultGstPercent: Number(rest.defaultGstPercent), hasLogo: Boolean(s.logoData) };
}

async function current(): Promise<CompanySettings> {
  return prisma.companySettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
}

function afterSave() {
  invalidateSettingsCache();
  safeRevalidate(SETTINGS_PATH, "/", "/dashboard");
}

export async function updateSettings(raw: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const input = parse(settingsInputSchema, raw);
    const before = await current();
    const holidays = Array.from(new Set(input.holidays))
      .sort()
      .map((key) => parseDateKey(key, "UTC"));
    const after = await prisma.companySettings.update({
      where: { id: "default" },
      data: {
        ...input,
        workingDays: Array.from(new Set(input.workingDays)).sort((a, b) => a - b),
        holidays,
      },
    });
    await audit(actor.id, "settings.update", "CompanySettings", "default", snapshot(before), snapshot(after));
    afterSave();
    return { updatedAt: after.updatedAt.toISOString() };
  });
}

/** Stores the uploaded logo bytes in the DB and points `logoUrl` at the streaming route. */
export async function uploadLogo(formData: FormData): Promise<ActionResult<{ logoUrl: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file");
    if (!file.type.startsWith("image/")) throw new Error("Logo must be an image (PNG, JPG, SVG or WebP)");
    if (file.size > LOGO_MAX_BYTES) throw new Error("Logo must be 2 MB or smaller");
    const bytes = Buffer.from(await file.arrayBuffer());
    const before = await current();
    const logoUrl = "/api/files/logo";
    const after = await prisma.companySettings.update({ where: { id: "default" }, data: { logoData: bytes, logoUrl } });
    await audit(actor.id, "settings.logo.upload", "CompanySettings", "default", snapshot(before), snapshot(after));
    afterSave();
    return { logoUrl };
  });
}

export async function removeLogo(): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const before = await current();
    const after = await prisma.companySettings.update({ where: { id: "default" }, data: { logoData: null, logoUrl: null } });
    await audit(actor.id, "settings.logo.remove", "CompanySettings", "default", snapshot(before), snapshot(after));
    afterSave();
    return undefined;
  });
}
