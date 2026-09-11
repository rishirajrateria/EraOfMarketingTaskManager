"use client";
import { useState } from "react";
import { btnPrimary } from "@/components/ui/Field";
import { ScreenHeader, useAdminAction } from "@/components/admin/AdminUi";
import {
  BankSection,
  CompanySection,
  GoogleStatusSection,
  HolidaysSection,
  InvoicingSection,
  LogoSection,
  NotificationsSection,
  WorkingTimeSection,
  type SettingsValues,
} from "@/components/admin/SettingsSections";
import { ExpenseCategoriesSection } from "@/components/admin/ExpenseCategoriesSection";
import { removeLogo, updateSettings, uploadLogo } from "@/server/admin/settings-actions";
import type { GoogleStatus, SettingsDto } from "@/server/admin/queries";

function toValues(s: SettingsDto): SettingsValues {
  const { logoUrl: _l, hasLogo: _h, updatedAt: _u, ...rest } = s;
  return rest;
}

/** /admin/settings — every CompanySettings field (SPEC §11.9). */
export function SettingsForm({ settings, google }: { settings: SettingsDto; google: GoogleStatus }) {
  const { busy, run } = useAdminAction();
  const [v, setV] = useState<SettingsValues>(() => toValues(settings));
  const [dirty, setDirty] = useState(false);
  const patch = (p: Partial<SettingsValues>) => {
    setV((s) => ({ ...s, ...p }));
    setDirty(true);
  };

  const save = async () => {
    const res = await run(updateSettings(v), "Settings saved");
    if (res) setDirty(false);
  };
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append("logo", file);
    await run(uploadLogo(fd), "Logo updated");
  };

  return (
    <form
      className="flex flex-1 flex-col pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <ScreenHeader title="Settings" subtitle="Company profile, invoicing, expenses, working time and integrations" />
      <CompanySection v={v} patch={patch} />
      <LogoSection logoUrl={settings.hasLogo ? settings.logoUrl : null} version={settings.updatedAt} busy={busy} onUpload={upload} onRemove={() => void run(removeLogo(), "Logo removed")} />
      <BankSection v={v} patch={patch} />
      <WorkingTimeSection v={v} patch={patch} />
      <HolidaysSection v={v} patch={patch} />
      <InvoicingSection v={v} patch={patch} />
      <ExpenseCategoriesSection v={v} patch={patch} />
      <NotificationsSection v={v} patch={patch} />
      <GoogleStatusSection status={google} />
      <div className="fixed bottom-0 z-30 w-full max-w-[480px] border-t bg-white/95 px-4 py-3 backdrop-blur" style={{ left: "50%", transform: "translateX(-50%)" }}>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy || !dirty}>
          {busy ? "Saving…" : dirty ? "Save settings" : "Saved"}
        </button>
      </div>
    </form>
  );
}
