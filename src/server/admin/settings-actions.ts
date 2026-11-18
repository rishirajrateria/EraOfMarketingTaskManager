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

/** Company settings actions (SPEC §11.9, ADR 0007). ADMIN-only; every save is audited and busts the settings cache. */

const SETTINGS_PATH = "/admin/settings";
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Audit snapshot without the binary images. */
function snapshot(s: CompanySettings) {
  const { logoData: _logo, signatureData: _sig, ...rest } = s;
  return { ...rest, defaultGstPercent: Number(rest.defaultGstPercent), tdsThresholdAmount: Number(rest.tdsThresholdAmount), hasLogo: Boolean(s.logoData), hasSignature: Boolean(s.signatureData) };
}

type ImageKind = "logo" | "signature";
const IMAGE = {
  logo: { field: "logo", label: "Logo", url: "/api/files/logo", data: "logoData", urlField: "logoUrl" },
  signature: { field: "signature", label: "Signature", url: "/api/files/signature", data: "signatureData", urlField: "signatureUrl" },
} as const;

async function storeImage(kind: ImageKind, formData: FormData): Promise<string> {
  const meta = IMAGE[kind];
  const actor = await requireRole("ADMIN");
  const file = formData.get(meta.field);
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image file");
  if (!file.type.startsWith("image/")) throw new Error(`${meta.label} must be an image (PNG, JPG, SVG or WebP)`);
  if (file.size > IMAGE_MAX_BYTES) throw new Error(`${meta.label} must be 2 MB or smaller`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const before = await current();
  const after = await prisma.companySettings.update({ where: { id: "default" }, data: { [meta.data]: bytes, [meta.urlField]: meta.url } });
  await audit(actor.id, `settings.${kind}.upload`, "CompanySettings", "default", snapshot(before), snapshot(after));
  afterSave();
  return meta.url;
}

async function clearImage(kind: ImageKind): Promise<void> {
  const meta = IMAGE[kind];
  const actor = await requireRole("ADMIN");
  const before = await current();
  const after = await prisma.companySettings.update({ where: { id: "default" }, data: { [meta.data]: null, [meta.urlField]: null } });
  await audit(actor.id, `settings.${kind}.remove`, "CompanySettings", "default", snapshot(before), snapshot(after));
  afterSave();
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
        expenseCategories: input.expenseCategories, // already trimmed + de-duplicated by the schema
      },
    });
    await audit(actor.id, "settings.update", "CompanySettings", "default", snapshot(before), snapshot(after));
    afterSave();
    return { updatedAt: after.updatedAt.toISOString() };
  });
}

/** Stores the uploaded logo bytes in the DB and points `logoUrl` at the streaming route. */
export async function uploadLogo(formData: FormData): Promise<ActionResult<{ logoUrl: string }>> {
  return wrap(async () => ({ logoUrl: await storeImage("logo", formData) }));
}

export async function removeLogo(): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    await clearImage("logo");
    return undefined;
  });
}

/** ADR 0007: signature image printed bottom-left on every invoice (form field `signature`). */
export async function uploadSignature(formData: FormData): Promise<ActionResult<{ signatureUrl: string }>> {
  return wrap(async () => ({ signatureUrl: await storeImage("signature", formData) }));
}

export async function removeSignature(): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    await clearImage("signature");
    return undefined;
  });
}
