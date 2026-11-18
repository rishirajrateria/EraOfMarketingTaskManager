"use client";
import { useRef } from "react";
import { btnSecondary } from "@/components/ui/Field";
import { Section } from "@/components/admin/SettingsSections";

/** Logo + signature uploads (SPEC §11.9, ADR 0007). Same mechanism for both: bytes in the DB, served from /api/files/<kind>. */
export function ImageUpload({ kind, url, version, busy, onUpload, onRemove, hint, wide }: { kind: "logo" | "signature"; url: string | null; version: string; busy: boolean; onUpload: (file: File) => void; onRemove: () => void; hint: string; wide?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const label = kind === "logo" ? "logo" : "signature";
  const box = wide ? "h-16 w-44" : "h-16 w-16";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`${url}?v=${encodeURIComponent(version)}`} alt={`Company ${label}`} className={`${box} rounded-lg border border-white/70 bg-white/60 object-contain backdrop-blur-md`} />
        ) : (
          <div className={`flex ${box} items-center justify-center rounded-lg border border-dashed border-white/80 bg-white/30 text-xs text-gray-500`}>No {label}</div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUpload(f);
              e.target.value = "";
            }}
          />
          <button type="button" className={btnSecondary} disabled={busy} onClick={() => fileRef.current?.click()}>
            {url ? `Replace ${label}` : `Upload ${label}`}
          </button>
          {url ? (
            <button type="button" className="text-left text-xs text-red-600" disabled={busy} onClick={onRemove}>
              Remove {label}
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-gray-400">{hint}</p>
    </div>
  );
}

export function ImagesSection({ logo, signature }: { logo: React.ReactNode; signature: React.ReactNode }) {
  return (
    <Section id="logo" title="Logo & signature">
      {logo}
      <div className="border-t border-white/60" />
      {signature}
    </Section>
  );
}
