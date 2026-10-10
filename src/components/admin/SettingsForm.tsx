"use client";
import { useState } from "react";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { Screen, ScreenHeader, useAdminAction } from "@/components/admin/AdminUi";
import {
  BankSection,
  SETTINGS_SECTIONS,
  CompanySection,
  GoogleStatusSection,
  HolidaysSection,
  InvoicingSection,
  NotificationsSection,
  TdsSection,
  ClientKitSection,
  WorkingTimeSection,
  type SettingsValues,
} from "@/components/admin/SettingsSections";
import { ExpenseCategoriesSection } from "@/components/admin/ExpenseCategoriesSection";
import { ImageUpload, ImagesSection } from "@/components/admin/SettingsImages";
import { removeLogo, removeSignature, updateSettings, uploadLogo, uploadSignature } from "@/server/admin/settings-actions";
import type { GoogleStatus, SettingsDto } from "@/server/admin/queries";

function toValues(s: SettingsDto): SettingsValues {
  const { logoUrl: _l, hasLogo: _h, signatureUrl: _s, hasSignature: _hs, updatedAt: _u, ...rest } = s;
  return rest;
}

/** /admin/settings — every CompanySettings field (SPEC §11.9). */
export function SettingsForm({ settings, google }: { settings: SettingsDto; google: GoogleStatus }) {
  const { busy, run } = useAdminAction();
  const [v, setV] = useState<SettingsValues>(() => toValues(settings));
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const jump = (id: string) => {
    setSection(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const patch = (p: Partial<SettingsValues>) => {
    setV((s) => ({ ...s, ...p }));
    setDirty(true);
  };

  const save = async () => {
    const res = await run(updateSettings(v), "Settings saved");
    if (res) setDirty(false);
  };
  const upload = (kind: "logo" | "signature") => async (file: File) => {
    const fd = new FormData();
    fd.append(kind, file);
    if (kind === "logo") await run(uploadLogo(fd), "Logo updated");
    else await run(uploadSignature(fd), "Signature updated");
  };

  const zone = (
    <BottomZone
      menu
      rows={
        <ZoneRow label="Jump to section">
          {SETTINGS_SECTIONS.map((s) => (
            <ZonePill key={s.id} active={section === s.id} onClick={() => jump(s.id)}>
              {s.label}
            </ZonePill>
          ))}
        </ZoneRow>
      }
      right={
        <BarChip label={dirty ? "Save settings" : "Settings saved"} active={dirty} className={dirty ? "font-semibold" : "opacity-60"} onClick={busy || !dirty ? undefined : () => void save()}>
          {busy ? "Saving…" : dirty ? "Save settings" : "Saved"}
        </BarChip>
      }
    />
  );

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Screen header={<ScreenHeader title="Settings" subtitle={dirty ? "Unsaved changes" : "Company profile, invoicing, expenses, working time and integrations"} />} zone={zone}>
        <CompanySection v={v} patch={patch} />
        <ImagesSection
          logo={<ImageUpload kind="logo" url={settings.hasLogo ? settings.logoUrl : null} version={settings.updatedAt} busy={busy} onUpload={upload("logo")} onRemove={() => void run(removeLogo(), "Logo removed")} hint="PNG, JPG, SVG or WebP up to 2 MB. Printed top-left on invoices and receipts." />}
          signature={<ImageUpload kind="signature" wide url={settings.hasSignature ? settings.signatureUrl : null} version={settings.updatedAt} busy={busy} onUpload={upload("signature")} onRemove={() => void run(removeSignature(), "Signature removed")} hint="Signature image (e.g. name, signature, designation on white). Printed bottom-left on every invoice; without it the legal name + “Authorised signatory” is printed." />}
        />
        <BankSection v={v} patch={patch} />
        <WorkingTimeSection v={v} patch={patch} />
        <HolidaysSection v={v} patch={patch} />
        <InvoicingSection v={v} patch={patch} />
        <ExpenseCategoriesSection v={v} patch={patch} />
        <TdsSection v={v} patch={patch} />
        <ClientKitSection v={v} patch={patch} />
        <NotificationsSection v={v} patch={patch} />
        <GoogleStatusSection status={google} />
      </Screen>
    </form>
  );
}
