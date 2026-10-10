"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * One close control (ADR 0016 addendum, prototype `cornerMode` / `syncCorner` / `cornerTap`): the bottom-right 52px
 * button of the bottom row is the only ×. Whatever is open — a bottom sheet, a form page such as the new expense
 * editor — registers how to close itself here; the row's button turns + into × while anything is registered and a tap
 * closes the most recent one (a sheet opened over a page closes before the page). The global nav's + reads it, and so
 * does the add-task screen's own × (a sheet first, then the screen).
 */
type Entry = { id: number; close: () => void };

let stack: Entry[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const cornerStore = {
  /** Registers a closer on top; returns its removal. */
  push(close: () => void): () => void {
    const entry = { id: ++seq, close };
    stack = [...stack, entry];
    emit();
    return () => {
      const next = stack.filter((e) => e !== entry);
      if (next.length === stack.length) return;
      stack = next;
      emit();
    };
  },
  /** Closes the most recently opened thing; false when nothing is open. */
  closeTop(): boolean {
    const top = stack.at(-1);
    if (!top) return false;
    top.close();
    return true;
  },
  /** Closes everything open, newest first (Home tapped on the home screen). */
  closeAll(): void {
    [...stack].reverse().forEach((e) => e.close());
  },
  hasOpen: () => stack.length > 0,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};

/** True while something registered a close: the corner button shows ×. */
export function useCornerOpen(): boolean {
  return useSyncExternalStore(cornerStore.subscribe, cornerStore.hasOpen, () => false);
}

/**
 * While `active`, the corner × runs `close` (always the latest one passed; re-rendering does not reorder the stack).
 * Sheets register through `Sheet`; form pages call it directly.
 */
export function useCornerClose(close: () => void, active = true): void {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!active) return;
    return cornerStore.push(() => ref.current());
  }, [active]);
}
