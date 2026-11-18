"use client";
import { useSyncExternalStore } from "react";

/**
 * The bottom nav's + lives in the app shell, the add-task sheet in the task dashboard. While the dashboard is mounted
 * it registers its opener here so Task / Meeting open the sheet in place; elsewhere `open` returns false and the nav
 * goes to `/dashboard?add=…` instead (ADR 0016 addendum). The sheet also reports whether it is up (`setShown`): the
 * bottom nav stays visible under the add-task screen but highlights no tab meanwhile (prototype `navActive`).
 */
export type AddTaskMode = "WORK" | "MEETING";
type Opener = (mode: AddTaskMode) => void;

let opener: Opener | null = null;
let shown = false;
const listeners = new Set<() => void>();

export const addTaskStore = {
  /** Returns the unregister function (only clears the opener if it is still this one). */
  register(fn: Opener): () => void {
    opener = fn;
    return () => {
      if (opener === fn) opener = null;
    };
  },
  open(mode: AddTaskMode): boolean {
    if (!opener) return false;
    opener(mode);
    return true;
  },
  /** The add-task screen is up (true) or gone (false). */
  setShown(next: boolean): void {
    if (shown === next) return;
    shown = next;
    listeners.forEach((l) => l());
  },
  isShown: () => shown,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** True while the add-task screen is open (the nav then marks no tab as the open one). */
export function useAddTaskShown(): boolean {
  return useSyncExternalStore(addTaskStore.subscribe, addTaskStore.isShown, () => false);
}
