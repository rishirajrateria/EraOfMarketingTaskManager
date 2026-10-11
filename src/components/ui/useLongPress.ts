"use client";
import { useCallback, useRef } from "react";

/** Long-press with haptic feedback (SPEC §14). Falls back to right-click on desktop. */
export function useLongPress(onLongPress: () => void, onClick?: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  const start = useCallback(() => {
    fired.current = false;
    timer.current = setTimeout(() => {
      fired.current = true;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(25);
      onLongPress();
    }, ms);
  }, [onLongPress, ms]);

  const clear = useCallback(
    (triggerClick: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (triggerClick && !fired.current && onClick) onClick();
    },
    [onClick],
  );

  return {
    onPointerDown: start,
    onPointerUp: () => clear(true),
    onPointerLeave: () => clear(false),
    onPointerCancel: () => clear(false),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (!fired.current) {
        fired.current = true;
        onLongPress();
      }
    },
  };
}
