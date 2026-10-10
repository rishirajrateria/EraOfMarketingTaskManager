import { describe, it, expect } from "vitest";
import { fmtMinutes, dateChip } from "@/lib/time";
import { can } from "@/lib/rbac";

describe("smoke", () => {
  it("formats minutes", () => {
    expect(fmtMinutes(240)).toBe("4hrs");
    expect(fmtMinutes(90)).toBe("1.5hrs");
    expect(fmtMinutes(30)).toBe("30m");
  });
  it("date chips", () => {
    const now = new Date("2026-09-10T06:00:00Z");
    expect(dateChip(now, now)).toBe("Today");
    expect(dateChip(new Date("2026-09-11T06:00:00Z"), now)).toBe("Tom");
    expect(dateChip(new Date("2026-09-09T06:00:00Z"), now)).toBe("Yestr");
  });
  it("rbac matrix", () => {
    const admin = { id: "a", role: "ADMIN" as const, teamId: null, teamLeaderId: null };
    const exec = { id: "e", role: "EXECUTIVE" as const, teamId: null, teamLeaderId: null };
    expect(can.approveFinish(admin)).toBe(true);
    expect(can.approveFinish(exec)).toBe(false);
    expect(can.raiseReview(exec)).toBe(true);
    expect(can.startTask(exec)).toBe(false);
  });
});
