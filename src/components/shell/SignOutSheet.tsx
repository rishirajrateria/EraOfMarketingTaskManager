"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Sheet } from "@/components/ui/Sheet";
import { btnDanger, btnSecondary } from "@/components/ui/Field";
import { signOutNow } from "@/server/auth-actions";
import { clsx } from "@/lib/clsx";

/**
 * "Sign out?" (prototype `signOutSheet`), opened by the top bar's Sign out and the profile page's: "Keep me signed in"
 * (focused when the sheet opens, so Enter / a stray tap keeps you in) and a red "Sign out" that posts the NextAuth
 * sign-out server action and lands on /login.
 */
const RING = "outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";

function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={clsx(btnDanger, RING, "w-full")}>
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function SignOutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // the sheet portals in after mount: focus on the next frame
    const id = requestAnimationFrame(() => keepRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Sign out?">
      <div className="px-4 pb-1" data-signout-sheet>
        <p className="mb-3 text-[13.5px] leading-[1.45] text-muted">You can sign back in with Google any time.</p>
        <form action={signOutNow} className="grid grid-cols-2 gap-2.5">
          <button ref={keepRef} type="button" onClick={onClose} className={clsx(btnSecondary, RING, "whitespace-nowrap px-2")}>
            Keep me signed in
          </button>
          <SignOutButton />
        </form>
      </div>
    </Sheet>
  );
}
