/**
 * In-process pub/sub used by the SSE endpoint for real-time list updates (SPEC §14).
 * On multi-instance hosts, replace `bus` with a Redis pub/sub adapter; the interface is the same.
 */
export type AppEvent =
  | { type: "task.changed"; taskId: string; userIds?: string[] }
  | { type: "task.deleted"; taskId: string }
  | { type: "notification"; userId: string; notificationId: string }
  | { type: "requests.changed" }
  | { type: "leave.changed"; userId: string }
  | { type: "ping" };

type Listener = (e: AppEvent) => void;

const g = globalThis as unknown as { __eomBus?: Set<Listener> };
const listeners = (g.__eomBus ??= new Set<Listener>());

export const bus = {
  publish(e: AppEvent) {
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        /* ignore listener errors */
      }
    }
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
