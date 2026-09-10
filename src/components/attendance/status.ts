import type { AttendanceStatus } from "@prisma/client";

/** Cell colours: P green, A red, H amber, L blue, HOL grey (SPEC §11.5). */
export const STATUS_STYLE: Record<AttendanceStatus, { letter: string; label: string; cls: string }> = {
  PRESENT: { letter: "P", label: "Present", cls: "bg-green-100 text-green-800" },
  ABSENT: { letter: "A", label: "Absent", cls: "bg-red-100 text-red-800" },
  HALF_DAY: { letter: "H", label: "Half day", cls: "bg-amber-100 text-amber-800" },
  LEAVE: { letter: "L", label: "Leave", cls: "bg-blue-100 text-blue-800" },
  HOLIDAY: { letter: "HOL", label: "Holiday", cls: "bg-gray-200 text-gray-600" },
};

export const STATUS_ORDER: AttendanceStatus[] = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY"];
