import { describe, expect, it } from "vitest";
import type { TaskStatus } from "@prisma/client";
import { ACTIVE_STATUSES, canTransition, isOverdue, nextStatus, rowColour, workedMinutes, type Transition } from "@/server/tasks/state";

const base = { overdue: false, doubtRaised: false } as const;

describe("rowColour", () => {
  it("maps plain statuses", () => {
    expect(rowColour({ ...base, status: "DRAFT" })).toBe("white");
    expect(rowColour({ ...base, status: "ASSIGNED" })).toBe("white");
    expect(rowColour({ ...base, status: "STARTED" })).toBe("green");
    expect(rowColour({ ...base, status: "FINISH_REQUESTED" })).toBe("green");
    expect(rowColour({ ...base, status: "PAUSED" })).toBe("green");
    expect(rowColour({ ...base, status: "COMPLETED" })).toBe("grey");
  });

  it("precedence: grey > yellow > red > green > white", () => {
    expect(rowColour({ status: "COMPLETED", overdue: true, doubtRaised: true })).toBe("grey");
    expect(rowColour({ status: "STARTED", overdue: true, doubtRaised: true })).toBe("yellow");
    expect(rowColour({ status: "STARTED", overdue: true, doubtRaised: false })).toBe("red");
    expect(rowColour({ status: "ASSIGNED", overdue: true, doubtRaised: false })).toBe("red");
    expect(rowColour({ status: "ASSIGNED", overdue: false, doubtRaised: true })).toBe("yellow");
    expect(rowColour({ status: "STARTED", overdue: false, doubtRaised: false })).toBe("green");
  });
});

describe("canTransition / nextStatus", () => {
  const all: TaskStatus[] = ["DRAFT", "ASSIGNED", "STARTED", "PAUSED", "FINISH_REQUESTED", "COMPLETED"];
  const table: Record<Transition, TaskStatus[]> = {
    START: ["ASSIGNED", "DRAFT"],
    PAUSE: ["ASSIGNED", "STARTED", "FINISH_REQUESTED"],
    RESUME: ["PAUSED"],
    REQUEST_FINISH: ["STARTED"],
    APPROVE_FINISH: ["FINISH_REQUESTED", "STARTED"],
    REJECT_FINISH: ["FINISH_REQUESTED"],
    RESTART: ["COMPLETED"],
  };

  it("allows exactly the transitions in the SPEC §7 table", () => {
    for (const t of Object.keys(table) as Transition[]) {
      for (const s of all) {
        expect(canTransition(s, t), `${t} from ${s}`).toBe(table[t].includes(s));
      }
    }
  });

  it("computes target states", () => {
    expect(nextStatus("ASSIGNED", "START")).toBe("STARTED");
    expect(nextStatus("DRAFT", "START")).toBe("STARTED");
    expect(nextStatus("STARTED", "PAUSE")).toBe("PAUSED");
    expect(nextStatus("STARTED", "REQUEST_FINISH")).toBe("FINISH_REQUESTED");
    expect(nextStatus("FINISH_REQUESTED", "APPROVE_FINISH")).toBe("COMPLETED");
    expect(nextStatus("STARTED", "APPROVE_FINISH")).toBe("COMPLETED");
    expect(nextStatus("FINISH_REQUESTED", "REJECT_FINISH")).toBe("STARTED");
    expect(nextStatus("COMPLETED", "RESTART")).toBe("ASSIGNED");
  });

  it("RESUME returns to statusBeforePause (default STARTED)", () => {
    expect(nextStatus("PAUSED", "RESUME", "ASSIGNED")).toBe("ASSIGNED");
    expect(nextStatus("PAUSED", "RESUME", "FINISH_REQUESTED")).toBe("FINISH_REQUESTED");
    expect(nextStatus("PAUSED", "RESUME", "STARTED")).toBe("STARTED");
    expect(nextStatus("PAUSED", "RESUME", null)).toBe("STARTED");
    expect(nextStatus("PAUSED", "RESUME")).toBe("STARTED");
  });

  it("throws on illegal transitions", () => {
    expect(() => nextStatus("COMPLETED", "START")).toThrow(/Cannot START a task in state COMPLETED/);
    expect(() => nextStatus("STARTED", "RESUME")).toThrow();
    expect(() => nextStatus("ASSIGNED", "REQUEST_FINISH")).toThrow();
    expect(() => nextStatus("STARTED", "RESTART")).toThrow();
    expect(() => nextStatus("PAUSED", "PAUSE")).toThrow();
  });

  it("ACTIVE_STATUSES excludes COMPLETED only", () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual(["ASSIGNED", "DRAFT", "FINISH_REQUESTED", "PAUSED", "STARTED"]);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-09-15T08:00:00Z");
  const past = new Date("2026-09-15T06:00:00Z");
  const future = new Date("2026-09-15T10:00:00Z");

  it("meetings are never overdue", () => {
    expect(isOverdue({ status: "ASSIGNED", scheduledStart: past, scheduledEnd: past, actualStart: null, type: "MEETING" }, now)).toBe(false);
  });

  it("not started after scheduledStart → overdue (ASSIGNED / DRAFT)", () => {
    expect(isOverdue({ status: "ASSIGNED", scheduledStart: past, scheduledEnd: future, actualStart: null, type: "WORK" }, now)).toBe(true);
    expect(isOverdue({ status: "DRAFT", scheduledStart: past, scheduledEnd: future, actualStart: null }, now)).toBe(true);
  });

  it("not yet due → fine", () => {
    expect(isOverdue({ status: "ASSIGNED", scheduledStart: future, scheduledEnd: future, actualStart: null, type: "WORK" }, now)).toBe(false);
    expect(isOverdue({ status: "ASSIGNED", scheduledStart: null, scheduledEnd: null, actualStart: null }, now)).toBe(false);
  });

  it("started on time but past scheduledEnd → overdue", () => {
    expect(isOverdue({ status: "STARTED", scheduledStart: past, scheduledEnd: past, actualStart: past, type: "WORK" }, now)).toBe(true);
    expect(isOverdue({ status: "FINISH_REQUESTED", scheduledStart: past, scheduledEnd: past, actualStart: past }, now)).toBe(true);
    expect(isOverdue({ status: "STARTED", scheduledStart: past, scheduledEnd: future, actualStart: past, type: "WORK" }, now)).toBe(false);
  });

  it("PAUSED and COMPLETED are never overdue", () => {
    expect(isOverdue({ status: "PAUSED", scheduledStart: past, scheduledEnd: past, actualStart: past, type: "WORK" }, now)).toBe(false);
    expect(isOverdue({ status: "COMPLETED", scheduledStart: past, scheduledEnd: past, actualStart: past, type: "WORK" }, now)).toBe(false);
  });

  it("boundary: exactly at scheduledEnd is not overdue", () => {
    expect(isOverdue({ status: "STARTED", scheduledStart: past, scheduledEnd: now, actualStart: past }, now)).toBe(false);
  });
});

describe("workedMinutes", () => {
  const t0 = new Date("2026-09-15T04:30:00Z");
  it("sums closed sessions", () => {
    const sessions = [
      { startedAt: t0, endedAt: new Date(t0.getTime() + 30 * 60000) },
      { startedAt: new Date(t0.getTime() + 60 * 60000), endedAt: new Date(t0.getTime() + 90 * 60000) },
    ];
    expect(workedMinutes(sessions)).toBe(60);
  });
  it("counts an open session up to now (pauses excluded)", () => {
    const now = new Date(t0.getTime() + 100 * 60000);
    const sessions = [
      { startedAt: t0, endedAt: new Date(t0.getTime() + 30 * 60000) },
      { startedAt: new Date(t0.getTime() + 90 * 60000), endedAt: null },
    ];
    expect(workedMinutes(sessions, now)).toBe(40);
  });
  it("is 0 with no sessions and never negative", () => {
    expect(workedMinutes([])).toBe(0);
    expect(workedMinutes([{ startedAt: t0, endedAt: new Date(t0.getTime() - 60000) }])).toBe(0);
  });
});
