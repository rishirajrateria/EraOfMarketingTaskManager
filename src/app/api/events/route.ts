import { bus, type AppEvent } from "@/lib/events";
import { currentUser } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: AppEvent) => {
        if (e.type === "notification" && e.userId !== user.id) return;
        if (e.type === "task.changed" && e.userIds && !e.userIds.includes(user.id) && user.role !== "ADMIN") return;
        if (e.type === "leave.changed" && e.userId !== user.id && user.role !== "ADMIN" && user.role !== "HR") return;
        if (e.type === "requests.changed" && user.role !== "ADMIN" && user.role !== "HR") return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* closed */
        }
      };
      unsubscribe = bus.subscribe(send);
      ping = setInterval(() => send({ type: "ping" }), 25_000);
      controller.enqueue(encoder.encode(`: connected\n\n`));
    },
    cancel() {
      unsubscribe?.();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
