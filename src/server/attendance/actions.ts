"use server";
/**
 * Attendance server actions (SPEC §11.5): self check-in/out, HR/Admin marking, CSV export.
 */
import { z } from "zod";
import { toZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { wrap, type ActionResult } from "@/lib/action-result";
import { ForbiddenError, requireRole, requireUser } from "@/lib/rbac";
import { safeRevalidate } from "@/lib/revalidate";
import { getSettings } from "@/lib/settings";
import { dateKey, hhmmToMinutes, parseDateKey, zonedDayAt } from "@/lib/time";
import { toDbDate } from "@/server/inventory/compute";
import { attendanceMonth, canSeeAllAttendance, gridToCsv } from "@/server/attendance/queries";

/** Check-in at/after this local time counts as a half day. */
const HALF_DAY_AFTER_MINUTES = 14 * 60;

const ATTENDANCE_PATHS = ["/attendance", "/admin/inventory"];

const statusSchema = z.enum(["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY"]);
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const hhmmSchema = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:mm");

function localMinutesOfDay(d: Date, tz: string): number {
  const local = toZonedTime(d, tz);
  return local.getHours() * 60 + local.getMinutes();
}

export async function checkIn(): Promise<ActionResult<{ date: string; status: string }>> {
  return wrap(async () => {
    const u = await requireUser();
    const s = await getSettings();
    const now = new Date();
    const key = dateKey(now, s.timezone);
    const date = toDbDate(key);
    const late = localMinutesOfDay(now, s.timezone) >= HALF_DAY_AFTER_MINUTES;
    const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: u.id, date } } });
    if (existing?.checkIn) return { date: key, status: existing.status };
    const row = existing
      ? await prisma.attendance.update({ where: { id: existing.id }, data: { checkIn: now } })
      : await prisma.attendance.create({ data: { userId: u.id, date, checkIn: now, status: late ? "HALF_DAY" : "PRESENT", markedById: u.id } });
    await audit(u.id, "attendance.checkIn", "Attendance", row.id, existing ?? null, row);
    safeRevalidate(...ATTENDANCE_PATHS);
    return { date: key, status: row.status };
  });
}

export async function checkOut(): Promise<ActionResult<{ date: string; checkOut: string }>> {
  return wrap(async () => {
    const u = await requireUser();
    const s = await getSettings();
    const now = new Date();
    const key = dateKey(now, s.timezone);
    const date = toDbDate(key);
    const existing = await prisma.attendance.findUnique({ where: { userId_date: { userId: u.id, date } } });
    if (!existing?.checkIn) throw new Error("Check in first");
    const row = await prisma.attendance.update({ where: { id: existing.id }, data: { checkOut: now } });
    await audit(u.id, "attendance.checkOut", "Attendance", row.id, existing, row);
    safeRevalidate(...ATTENDANCE_PATHS);
    return { date: key, checkOut: now.toISOString() };
  });
}

const markSchema = z.object({
  userId: z.string().min(1),
  date: dateKeySchema,
  status: statusSchema,
  checkIn: hhmmSchema.optional().nullable(),
  checkOut: hhmmSchema.optional().nullable(),
  note: z.string().max(500).optional().nullable(),
});
export type MarkAttendanceInput = z.input<typeof markSchema>;

/** HR/Admin mark or correct any user's day. */
export async function markAttendance(input: MarkAttendanceInput): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("HR", "ADMIN");
    const data = markSchema.parse(input);
    const s = await getSettings();
    const tz = s.timezone;
    const target = await prisma.user.findUnique({ where: { id: data.userId }, select: { id: true } });
    if (!target) throw new Error("User not found");
    const day = parseDateKey(data.date, tz);
    const date = toDbDate(data.date);
    const checkIn = data.checkIn ? zonedDayAt(day, hhmmToMinutes(data.checkIn), tz) : null;
    const checkOut = data.checkOut ? zonedDayAt(day, hhmmToMinutes(data.checkOut), tz) : null;
    const before = await prisma.attendance.findUnique({ where: { userId_date: { userId: data.userId, date } } });
    const values = { status: data.status, checkIn, checkOut, note: data.note ?? null, markedById: actor.id };
    const row = await prisma.attendance.upsert({
      where: { userId_date: { userId: data.userId, date } },
      create: { userId: data.userId, date, ...values },
      update: values,
    });
    await audit(actor.id, "attendance.mark", "Attendance", row.id, before ?? null, row);
    safeRevalidate(...ATTENDANCE_PATHS);
    return { id: row.id };
  });
}

const exportSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), userId: z.string().optional() });

/** Returns CSV text; the client downloads it as a Blob. Non-HR/Admin users only get their own rows. */
export async function exportAttendanceCsv(input: z.input<typeof exportSchema>): Promise<ActionResult<{ csv: string; filename: string }>> {
  return wrap(async () => {
    const u = await requireUser();
    const data = exportSchema.parse(input);
    if (!canSeeAllAttendance(u) && data.userId && data.userId !== u.id) throw new ForbiddenError();
    const grid = await attendanceMonth(u, data);
    return { csv: gridToCsv(grid), filename: `attendance-${grid.month}${data.userId ? "-" + data.userId : ""}.csv` };
  });
}
