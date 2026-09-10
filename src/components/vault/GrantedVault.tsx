"use client";
import { useState } from "react";
import type { GrantedGroup, GrantedItem } from "@/server/vault/queries";
import { KIND_LABEL } from "@/server/vault/queries";
import { RevealSecret } from "@/components/vault/RevealSecret";
import { ExpiryLine } from "@/components/vault/ExpiryLine";

/** /vault — items the signed-in user currently has an active grant for, grouped by client and kind. */
export function GrantedVault({ groups }: { groups: GrantedGroup[] }) {
  if (groups.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-gray-500">You have no vault access right now. Ask Admin to grant it.</p>;
  }
  return (
    <div className="space-y-4 px-3 py-3 pb-24">
      {groups.map((g) => (
        <section key={g.clientId}>
          <h2 className="px-1 text-sm font-bold">{g.clientName}</h2>
          {g.kinds.map((k) => (
            <div key={k.kind} className="mt-2">
              <h3 className="px-1 text-[11px] font-medium uppercase text-gray-400">{KIND_LABEL[k.kind]}</h3>
              <ul className="mt-1 space-y-2">
                {k.items.map((it) => (
                  <GrantedRow key={it.id} item={it} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function GrantedRow({ item }: { item: GrantedItem }) {
  // Grant state is updated locally after the first reveal so the after-first-open countdown starts at once.
  const [grant, setGrant] = useState(item.grant);
  return (
    <li className="rounded-xl bg-white p-3 shadow-sm">
      <div className="text-sm font-semibold">{item.label}</div>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand-blue underline">
          {item.url}
        </a>
      ) : null}
      {item.username ? <div className="text-xs text-gray-600">User: {item.username}</div> : null}
      {item.notes ? <div className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{item.notes}</div> : null}
      <div className="mt-2">
        <RevealSecret
          itemId={item.id}
          hasPassword={item.hasPassword}
          onRevealed={(r) => {
            if (r.grant) setGrant((g) => ({ ...g, firstOpenedAt: r.grant!.firstOpenedAt, expiresAt: r.grant!.expiresAt, expiresAfterFirstOpenMinutes: r.grant!.expiresAfterFirstOpenMinutes }));
          }}
        />
      </div>
      <div className="mt-2 border-t pt-1">
        <ExpiryLine grant={grant} />
      </div>
    </li>
  );
}
