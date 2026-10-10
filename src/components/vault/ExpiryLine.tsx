"use client";
import { useEffect, useState } from "react";
import { describeExpiry, grantIsActive, type GrantLike } from "@/server/vault/access";
import { clsx } from "@/lib/clsx";

/** Live "Expires in 12m 03s" line. Ticks every second while an expiry instant is known. */
export function ExpiryLine({ grant, className }: { grant: GrantLike; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const active = grantIsActive(grant, now);
  return (
    <span className={clsx("text-[11px]", active ? "text-gray-500" : "text-red-600", className)} suppressHydrationWarning>
      {describeExpiry(grant, now)}
    </span>
  );
}
