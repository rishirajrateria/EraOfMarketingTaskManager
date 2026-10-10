"use server";
/**
 * Attendance server actions (SPEC §11.5). Attendance is marked by HR/Admin only — there is no self
 * check-in; staff see their own month read-only. HR/Admin mark or correct any day and export CSV.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { wrap, type ActionResult } from "@/lib/action-result";
import { ForbiddenError, requireRole, requireUser } from "@/lib/rbac";
import { safeRevalidate } from "@/lib/revalidate";
import { getSettings } from "@/lib/settings";
import { hhmmToMinutes, parseDateKey, zonedDayAt } from "@/lib/time";
import { toDbDate } from "@/server/inventory/compute";
import { attendanceMonth, canSeeAllAttendance, gridToCsv } from "@/server/attendance/queries";

const ATTENDANCE_PATHS = ["/attendance", "/admin/inventory"];

const statusSchema = z.enum(["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY"]);
const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const hhmmSchema = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:mm");

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
    // Days covered by an already-approved leave can only be changed by Admin (SPEC §2).
    if (actor.role === "HR" && data.status !== "LEAVE") {
      const approvedLeave = await prisma.leave.findFirst({
        where: { userId: data.userId, status: { in: ["HR_APPROVED", "ADMIN_APPROVED"] }, from: { lte: date }, to: { gte: date } },
        select: { id: true },
      });
      if (approvedLeave) throw new ForbiddenError("This day is covered by an approved leave; ask an Admin to change it");
    }
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
