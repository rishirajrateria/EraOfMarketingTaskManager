import { requireUser } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { attendanceMonth, canMarkAttendance, canSeeAllAttendance } from "@/server/attendance/queries";
import { AttendanceGrid } from "@/components/attendance/AttendanceGrid";

type Search = Promise<{ month?: string; userId?: string }>;

/**
 * Attendance (SPEC §11.5). Attendance is marked by HR/Admin only: they see everyone's monthly grid,
 * tap a cell to mark or correct a day, and export CSV. Everyone else sees their own month read-only.
 */
export default async function AttendancePage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const sp = await searchParams;
  const all = canSeeAllAttendance(user);
  const [grid, filterUsers] = await Promise.all([
    attendanceMonth(user, { month: sp.month, userId: all ? sp.userId : undefined }),
    all ? prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);

  return (
    <AttendanceGrid
      grid={grid}
      canMark={canMarkAttendance(user)}
      filterUsers={filterUsers}
      selectedUserId={all ? sp.userId : undefined}
      hint={all ? "Tap a cell to mark or correct a day." : "Your attendance is marked by HR."}
      isAdmin={user.role === "ADMIN"}
    />
  );
}
