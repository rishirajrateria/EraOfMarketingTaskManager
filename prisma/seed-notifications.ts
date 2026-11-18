/**
 * Demo data for ADR 0017: phones for the card's Call / WhatsApp sheet, and a handful of feed notifications (one per
 * colour) tied to the demo tasks so the bell isn't empty in demo mode. Imported by seed.ts; idempotent.
 */
import type { NotificationKind, PrismaClient } from "@prisma/client";

type Users = Record<"admin" | "rishi" | "neha" | "arush" | "dev" | "isha" | "arjun", { id: string }>;

const USER_PHONES: Record<keyof Users, string | null> = {
  admin: "+918910358506",
  rishi: "+919830011122",
  neha: "+919830044455",
  arush: "+919830022233",
  dev: null, // shows the greyed "no number saved" row
  isha: "+919830055566",
  arjun: "+919830066677",
};

/** Client numbers: Pharma Bag Co has none on purpose (greyed rows); Sunrise only WhatsApp (calls fall back to it). */
const CLIENT_CONTACTS: Record<string, { contact?: string; phone?: string | null; whatsapp?: string | null }> = {
  Repo: { contact: "Anil Mehra", phone: "+919876511111", whatsapp: "+919876511111" },
  Robam: { contact: "Sunita Rao", phone: "+919876522222", whatsapp: null },
  "Pharma Bag Co": { phone: null, whatsapp: null },
  "Sunrise Realty": { contact: "Vikram Shah", phone: null, whatsapp: "+919876544444" },
};

export async function seedDemoContacts(prisma: PrismaClient, users: Users, clients: { id: string; name: string }[]) {
  for (const [key, phone] of Object.entries(USER_PHONES)) await prisma.user.update({ where: { id: users[key as keyof Users].id }, data: { phone } });
  for (const c of clients) {
    const x = CLIENT_CONTACTS[c.name];
    if (x) await prisma.client.update({ where: { id: c.id }, data: { contact: x.contact ?? undefined, phone: x.phone ?? null, whatsapp: x.whatsapp ?? null } });
  }
}

type Demo = { to: (keyof Users)[]; task?: string; kind: NotificationKind; title: string; body?: string; hoursAgo: number; read?: boolean; href?: string };

/** One per colour (green, red, yellow, purple, grey, blue, amber) for Admin and the demo Team Leader. */
const DEMO: Demo[] = [
  { to: ["admin"], task: "[demo] Robam product shoot edit", kind: "TASK_STARTED", title: "Rishi started it on time", hoursAgo: 0.6 },
  { to: ["admin", "neha"], task: "[demo] Sunrise ad creatives", kind: "TASK_STARTED_LATE", title: "Neha started it 25 min late", hoursAgo: 1.2 },
  { to: ["admin", "rishi"], task: "[demo] Repo Instagram carousel", kind: "TASK_NOT_STARTED", title: "Not started · was due at 10:00am", hoursAgo: 1.5 },
  { to: ["admin", "rishi", "arush"], task: "[demo] Robam reel cut", kind: "TASK_PAUSED", title: "Paused by Admin · waiting for the client's footage", hoursAgo: 2 },
  { to: ["admin"], task: "[demo] Pharma bag packaging v3", kind: "DOUBT_RAISED", title: "Rishi raised a doubt", body: "Client sent two conflicting logo files — which one?", hoursAgo: 2.5 },
  { to: ["admin"], task: "[demo] Pharma bag social calendar", kind: "FINISH_REQUESTED", title: "Rishi marked it done from their side", hoursAgo: 3 },
  { to: ["rishi"], task: "[demo] Festive logo refresh — Robam", kind: "TASK_ASSIGNED", title: "New task from Admin · prefers Arush — assign it from the task", hoursAgo: 3.2 },
  { to: ["admin"], kind: "LEAVE_REQUESTED", title: "Arush asked for leave next week", body: "Family function", hoursAgo: 4, href: "/requests/leave" },
  { to: ["admin", "neha"], task: "[demo] Sunrise landing page copy", kind: "TASK_PAST_END", title: "Still not finished · was due to end at 12:00pm", hoursAgo: 26, read: true },
  { to: ["admin"], kind: "PAYMENT_RECEIVED", title: "₹50,000 received from Repo · ₹68,000 still due", hoursAgo: 27, read: true, href: "/admin/payments" },
  { to: ["admin"], kind: "TDS_THRESHOLD", title: "TDS threshold crossed for Skyline Spaces", body: "Deduct TDS on payments to this payee", hoursAgo: 28, href: "/admin/expenses" },
  { to: ["rishi", "arush"], task: "[demo] Repo monthly report", kind: "TASK_COMPLETED", title: "Completed · 10 min early", hoursAgo: 49, read: true },
];

/** Before the demo tasks are recreated: drop their notifications and the non-task demo ones. */
export async function clearDemoNotifications(prisma: PrismaClient) {
  const tasks = await prisma.task.findMany({ where: { title: { startsWith: "[demo]" } }, select: { id: true } });
  await prisma.notification.deleteMany({ where: { OR: [{ taskId: { in: tasks.map((t) => t.id) } }, { title: { in: DEMO.filter((d) => !d.task).map((d) => d.title) } }] } });
  // Rows left behind by demo tasks an earlier seed removed (their task no longer exists).
  const linked = await prisma.notification.findMany({ where: { taskId: { not: null } }, distinct: ["taskId"], select: { taskId: true } });
  const ids = linked.map((n) => n.taskId!);
  const alive = new Set((await prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((t) => t.id));
  const gone = ids.filter((id) => !alive.has(id));
  if (gone.length) await prisma.notification.deleteMany({ where: { taskId: { in: gone } } });
}

export async function seedDemoNotifications(prisma: PrismaClient, users: Users) {
  const now = Date.now();
  // The seeded updates stand in for the overdue job's one-time ones: mark them sent so the live job doesn't repeat
  // them for times that had already passed at seed time (later ones still arrive live).
  const at = new Date(now);
  await prisma.task.updateMany({ where: { title: { startsWith: "[demo]" }, scheduledStart: { lt: at } }, data: { notStartedNotifiedAt: at } });
  await prisma.task.updateMany({ where: { title: { startsWith: "[demo]" }, scheduledEnd: { lt: at } }, data: { pastEndNotifiedAt: at } });
  for (const d of DEMO) {
    const task = d.task ? await prisma.task.findFirst({ where: { title: d.task }, select: { id: true, status: true } }) : null;
    if (d.task && !task) continue;
    const createdAt = new Date(now - d.hoursAgo * 3_600_000);
    const href = task ? `/dashboard?task=${task.id}${task.status === "COMPLETED" ? "&completed=1" : ""}` : (d.href ?? null);
    await prisma.notification.createMany({
      data: d.to.map((k) => ({ userId: users[k].id, kind: d.kind, title: d.title, body: d.body ?? "", href, taskId: task?.id ?? null, createdAt, readAt: d.read ? createdAt : null })),
    });
  }
}
