"use client";
import { useSyncExternalStore } from "react";

/** Tiny global store so any screen (e.g. the bottom bar) can open the Admin menu tray. */
let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const menuStore = {
  open: () => {
    open = true;
    emit();
  },
  close: () => {
    open = false;
    emit();
  },
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => open,
};

export function useMenuOpen() {
  return useSyncExternalStore(menuStore.subscribe, menuStore.get, () => false);
}
