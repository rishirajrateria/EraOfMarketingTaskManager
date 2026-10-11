"use client";
import { useEffect, useState } from "react";
import { savePushSubscription } from "@/server/notifications";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** "Enable push notifications" button; also exposes window.__eomEnablePush for other screens. */
export function PushEnable() {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied">("off");
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !key) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off"));
  }, [key]);

  const enable = async () => {
    if (!key) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await savePushSubscription(json, navigator.userAgent);
    setState("on");
  };

  useEffect(() => {
    (window as unknown as { __eomEnablePush?: () => Promise<void> }).__eomEnablePush = enable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (state === "unsupported") return <p className="text-xs text-gray-500">Push notifications are not available on this device/browser (or VAPID keys are not configured).</p>;
  if (state === "denied") return <p className="text-xs text-red-600">Notifications are blocked in browser settings.</p>;
  if (state === "on") return <p className="text-xs text-green-700">Push notifications are enabled on this device.</p>;
  return (
    <button onClick={enable} className="touch-target rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white">
      Enable push notifications
    </button>
  );
}
