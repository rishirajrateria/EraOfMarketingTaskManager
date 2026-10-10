"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { getSettings } from "@/lib/settings";
import { isMock } from "@/google/client";
import { freeBusyMany } from "@/google/calendar";
import { ACTIVE_STATUSES } from "@/server/tasks/state";
import { findTimeWindow } from "@/server/tasks/meeting";

const inputSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1, "Invite someone first").max(50),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-MM-dd date"),
  timeZone: z.string().max(64).optional(),
});

export type BusyPerson = { id: string; name: string; source: "google" | "tasks"; busy: { start: string; end: string }[] };
export type MeetingBusy = { day: string; timeZone: string; from: string; to: string; people: BusyPerson[] };

/**
 * "Find a time" (ADR 0012): busy blocks of the internal guests on `day` between 08:00 and 21:00 (meeting time zone).
 * Real Google Calendar free/busy (one query, service account with domain-wide delegation) when not mocked; in
 * GOOGLE_MOCK mode — and for anyone whose calendar can't be read — the app's own scheduled tasks for that person.
 * External guests are never checked. Anyone with a dashboard may look (meetings may invite anyone).
 */
export async function meetingBusy(raw: unknown): Promise<ActionResult<MeetingBusy>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN" && user.role !== "TEAM_LEADER" && user.role !== "EXECUTIVE") throw new ForbiddenError();
    const input = inputSchema.parse(raw);
    const timeZone = input.timeZone || (await getSettings()).timezone;
    const { from, to } = findTimeWindow(input.day, timeZone);
    const ids = Array.from(new Set(input.userIds));
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, active: true, role: { in: ["ADMIN", "TEAM_LEADER", "EXECUTIVE"] } },
      select: { id: true, name: true, email: true },
    });
    if (users.length !== ids.length) throw new Error("Unknown or inactive guest");

    let google: Record<string, { start: Date; end: Date }[]> = {};
    if (!isMock()) google = await freeBusyMany(users.map((u) => u.email), from, to).catch(() => ({}));
    const fallback = users.filter((u) => !google[u.email.toLowerCase()]).map((u) => u.id);
    const tasks = fallback.length
      ? await prisma.task.findMany({
          where: {
            deletedAt: null,
            status: { in: ACTIVE_STATUSES },
            assignees: { some: { userId: { in: fallback } } },
            scheduledStart: { lt: to },
            OR: [{ scheduledEnd: { gt: from } }, { scheduledEnd: null, scheduledStart: { gte: new Date(from.getTime() - 24 * 3600_000) } }],
          },
          select: { scheduledStart: true, scheduledEnd: true, allocatedMinutes: true, assignees: { select: { userId: true } } },
        })
      : [];

    const people: BusyPerson[] = ids.map((id) => {
      const u = users.find((x) => x.id === id)!;
      const fromGoogle = google[u.email.toLowerCase()];
      const blocks = fromGoogle
        ? fromGoogle
        : tasks
            .filter((t) => t.assignees.some((a) => a.userId === id) && t.scheduledStart)
            .map((t) => ({ start: t.scheduledStart!, end: t.scheduledEnd ?? new Date(t.scheduledStart!.getTime() + t.allocatedMinutes * 60000) }));
      const busy = blocks
        .filter((b) => b.end > from && b.start < to)
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() }));
      return { id, name: u.name, source: fromGoogle ? "google" : "tasks", busy };
    });
    return { day: input.day, timeZone, from: from.toISOString(), to: to.toISOString(), people };
  });
}
