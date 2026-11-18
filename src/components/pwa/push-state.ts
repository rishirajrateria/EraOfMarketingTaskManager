/** Pure helpers for the /me "Enable notifications" control (kept free of React so they are unit-testable). */

export type PushState = "checking" | "unsupported" | "unconfigured" | "denied" | "off" | "on";

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** What the control shows before it knows whether this browser already holds a subscription. */
export function baseState(env: { hasServiceWorker: boolean; hasPushManager: boolean; hasNotification: boolean; permission: string | null; vapidKey: string }): PushState {
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (!env.vapidKey) return "unconfigured";
  if (env.permission === "denied") return "denied";
  return "checking";
}

export const PUSH_COPY: Record<PushState, { label: string; hint: string }> = {
  checking: { label: "Enable notifications", hint: "Checking this device…" },
  unsupported: { label: "Push unavailable", hint: "This browser or device can't receive push notifications. On iPhone, add the app to the Home Screen first." },
  unconfigured: { label: "Push not configured", hint: "Push isn't set up on this server yet (no VAPID keys). Ask an admin to configure it." },
  denied: { label: "Push blocked", hint: "Notifications are blocked for this site. Allow them in your browser's site settings, then reload." },
  off: { label: "Enable notifications", hint: "Tap “Enable notifications” below to get alerts even when the app is closed." },
  on: { label: "Push on", hint: "Enabled on this device." },
};
