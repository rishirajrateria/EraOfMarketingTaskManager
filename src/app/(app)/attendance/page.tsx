import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/time";
import { attendanceMonth, canSeeAllAttendance, todayAttendance } from "@/server/attendance/queries";
import { AttendanceGrid } from "@/components/attendance/AttendanceGrid";
import { CheckInCard } from "@/components/attendance/CheckInCard";
import { fmtTime } from "@/lib/time";
import Link from "next/link";

type Search = Promise<{ month?: string; userId?: string }>;

/**
 * Attendance (SPEC §11.5). Admin & HR: everyone's monthly grid, marking, export.
 * Everyone else: own check-in/out and own month.
 */
export default async function AttendancePage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sp = await searchParams;
  const all = canSeeAllAttendance(user);
  const [today, grid, filterUsers] = await Promise.all([
    todayAttendance(user.id),
    attendanceMonth(user, { month: sp.month, userId: all ? sp.userId : undefined }),
    all ? prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const row = today.row
    ? { status: today.row.status, checkIn: today.row.checkIn ? fmtTime(today.row.checkIn, today.timezone) : null, checkOut: today.row.checkOut ? fmtTime(today.row.checkOut, today.timezone) : null }
    : null;

  return (
    <div className="pb-6">
      <CheckInCard dateLabel={fmtDate(new Date(), today.timezone, "EEE d MMM")} today={row} />
      <div className="mx-3 mt-3 flex items-center justify-between text-xs">
        <span className="text-gray-500">{all ? "Tap a cell to mark or correct a day." : "Your month"}</span>
        <Link href="/leave" className="text-brand-blue underline">
          Request leave
        </Link>
      </div>
      <AttendanceGrid grid={grid} canMark={all} filterUsers={filterUsers} selectedUserId={all ? sp.userId : undefined} />
    </div>
  );
}
