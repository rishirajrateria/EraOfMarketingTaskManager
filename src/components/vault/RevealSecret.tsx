"use client";
import { useState } from "react";
import { revealSecret, type RevealResult } from "@/server/vault/actions";
import { useToast } from "@/components/ui/Toast";
import { btnSecondary } from "@/components/ui/Field";

/**
 * Reveal / copy / hide a vault password. The plain text only ever lives in component state after a
 * successful `revealSecret` server action (which enforces access and logs the view).
 */
export function RevealSecret({ itemId, hasPassword, onRevealed }: { itemId: string; hasPassword: boolean; onRevealed?: (r: RevealResult) => void }) {
  const toast = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!hasPassword) return <span className="text-xs text-gray-400">No password</span>;

  async function reveal() {
    setBusy(true);
    const res = await revealSecret(itemId);
    setBusy(false);
    if (!res.ok) {
      toast(res.error, "err");
      return;
    }
    setSecret(res.data.password ?? "");
    onRevealed?.(res.data);
  }

  async function copy() {
    if (secret == null) return;
    try {
      await navigator.clipboard.writeText(secret);
      toast("Password copied");
    } catch {
      toast("Copy failed", "err");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm">{secret == null ? "••••••••" : secret}</span>
      {secret == null ? (
        <button type="button" className={btnSecondary} onClick={reveal} disabled={busy}>
          {busy ? "…" : "Reveal"}
        </button>
      ) : (
        <>
          <button type="button" className={btnSecondary} onClick={copy}>
            Copy
          </button>
          <button type="button" className={btnSecondary} onClick={() => setSecret(null)}>
            Hide
          </button>
        </>
      )}
    </div>
  );
}
