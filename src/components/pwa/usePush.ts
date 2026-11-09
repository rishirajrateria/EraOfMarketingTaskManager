"use client";
import { useCallback, useEffect, useState } from "react";
import { savePushSubscription } from "@/server/notifications";
import { baseState, urlBase64ToUint8Array, type PushState } from "@/components/pwa/push-state";

/** Web-push state and the enable action for this device. `vapidKey` comes from the server so it is read at runtime. */
export function usePush(vapidKey: string): { state: PushState; busy: boolean; error: string | null; enable: () => Promise<void> } {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = baseState({
      hasServiceWorker: "serviceWorker" in navigator,
      hasPushManager: "PushManager" in window,
      hasNotification: "Notification" in window,
      permission: "Notification" in window ? Notification.permission : null,
      vapidKey,
    });
    if (base !== "checking") return setState(base);
    let live = true;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((s) => live && setState(s && Notification.permission === "granted" ? "on" : "off"))
      .catch(() => live && setState("off"));
    return () => {
      live = false;
    };
  }, [vapidKey]);

  const enable = useCallback(async () => {
    if (!vapidKey) return;
    setBusy(true);
    setError(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const saved = await savePushSubscription(json, navigator.userAgent);
      if (!saved.ok) throw new Error(saved.error);
      setState("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't turn notifications on");
    } finally {
      setBusy(false);
    }
  }, [vapidKey]);

  return { state, busy, error, enable };
}
