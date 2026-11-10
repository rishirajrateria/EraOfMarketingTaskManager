import type { AttendanceStatus } from "@prisma/client";

/** Cell colours: P green, A red, H amber, L blue, HOL grey (SPEC §11.5). */
export const STATUS_STYLE: Record<AttendanceStatus, { letter: string; label: string; cls: string }> = {
  PRESENT: { letter: "P", label: "Present", cls: "border border-white/60 bg-green-100/70 text-green-800 backdrop-blur-sm" },
  ABSENT: { letter: "A", label: "Absent", cls: "border border-white/60 bg-red-100/70 text-red-800 backdrop-blur-sm" },
  HALF_DAY: { letter: "H", label: "Half day", cls: "border border-white/60 bg-amber-100/70 text-amber-800 backdrop-blur-sm" },
  LEAVE: { letter: "L", label: "Leave", cls: "border border-white/60 bg-blue-100/70 text-blue-800 backdrop-blur-sm" },
  HOLIDAY: { letter: "HOL", label: "Holiday", cls: "border border-white/60 bg-gray-200/70 text-gray-700 backdrop-blur-sm" },
};

export const STATUS_ORDER: AttendanceStatus[] = ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY"];
