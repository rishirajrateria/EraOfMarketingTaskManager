import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { subDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, loadTask, settle } from "./helpers";
import { dateKey, zonedDayAt } from "@/lib/time";

const session = mockSession();
const TZ = "Asia/Kolkata";
const DAY = 86_400_000;

describe("recurring tasks", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150); // let createTask's fire-and-forget queue drain before the next resetDb()
  });

  it("createTask with a DAILY ON_SCHEDULE rule sets nextRunAt one interval after the start", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { title: "Daily report", recurrence: { frequency: "DAILY", interval: 1, trigger: "ON_SCHEDULE" } });
    const t = await loadTask(id);
    expect(t.recurrenceRuleId).toBeTruthy();
    expect(t.recurrenceRule!.frequency).toBe("DAILY");
    expect(t.recurrenceRule!.trigger).toBe("ON_SCHEDULE");
    expect(t.recurrenceRule!.stopped).toBe(false);
    expect(t.recurrenceRule!.nextRunAt).not.toBeNull();
    expect(t.recurrenceRule!.nextRunAt!.getTime()).toBe(t.scheduledStart!.getTime() + DAY);
    expect(t.parentTaskId).toBeNull();
  });

  it("jobs/recurrence spawns one occurrence when nextRunAt has arrived and is idempotent afterwards", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { title: "Daily report", recurrence: { frequency: "DAILY", interval: 1, trigger: "ON_SCHEDULE" } });
    const ruleId = (await loadTask(id)).recurrenceRuleId!;
    await testDb.recurrenceRule.update({ where: { id: ruleId }, data: { nextRunAt: new Date(Date.now() - 3_600_000) } });

    const { run } = await import("@/jobs/recurrence");
    const r1 = await run();
    expect(r1.created).toBe(1);
    const tasks = await testDb.task.findMany({ where: { recurrenceRuleId: ruleId }, orderBy: { createdAt: "asc" } });
    expect(tasks).toHaveLength(2);
    const next = tasks[1];
    expect(next.id).not.toBe(id);
    expect(next.parentTaskId).toBe(id);
    expect(next.status).toBe("ASSIGNED");
    expect(next.title).toBe("Daily report");
    expect(next.scheduledStart).not.toBeNull();
    const assignees = await testDb.taskAssignee.findMany({ where: { taskId: next.id } });
    expect(assignees.map((a) => a.userId)).toEqual([tl.id]);
    const jobs = await testDb.integrationJob.findMany({ where: { taskId: next.id } });
    expect(jobs.map((j) => j.kind).sort()).toEqual(["CALENDAR_EVENT", "CHAT_SPACE", "DRIVE_FOLDER"]);
    expect(await testDb.notification.count({ where: { taskId: next.id, kind: "TASK_ASSIGNED", userId: tl.id } })).toBe(1);

    const rule = await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.nextRunAt!.getTime()).toBeGreaterThan(Date.now());

    // running again immediately creates nothing (nextRunAt advanced)
    const r2 = await run();
    expect(r2.created).toBe(0);
    expect(await testDb.task.count({ where: { recurrenceRuleId: ruleId } })).toBe(2);

    // and spawning directly for the same nextRunAt is a no-op thanks to the (rule, scheduledStart) idempotency check
    const { spawnNextOccurrence } = await import("@/server/tasks/recurring");
    await testDb.recurrenceRule.update({ where: { id: ruleId }, data: { nextRunAt: next.scheduledStart } });
    const again = await spawnNextOccurrence(id, null);
    expect(again).toBe(next.id);
    expect(await testDb.task.count({ where: { recurrenceRuleId: ruleId } })).toBe(2);
  });

  it("ON_SCHEDULE: the occurrence spawned by the job is scheduled AT the due nextRunAt, not one interval later", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { title: "Daily report", recurrence: { frequency: "DAILY", interval: 1, trigger: "ON_SCHEDULE" } });
    const ruleId = (await loadTask(id)).recurrenceRuleId!;
    // due = 10:00 IST on a recent working day (>= 2 days ago, never a Sunday) so findSlot(due) === due
    let due = zonedDayAt(subDays(new Date(), 2), 600, TZ);
    while (toZonedTime(due, TZ).getDay() === 0) due = subDays(due, 1);
    await testDb.recurrenceRule.update({ where: { id: ruleId }, data: { nextRunAt: due } });

    const { run } = await import("@/jobs/recurrence");
    expect((await run()).created).toBe(1);
    const next = await testDb.task.findFirstOrThrow({ where: { recurrenceRuleId: ruleId, id: { not: id } } });
    expect(next.scheduledStart!.toISOString()).toBe(due.toISOString());
    const rule = await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.nextRunAt!.toISOString()).toBe(new Date(due.getTime() + DAY).toISOString());
  });

  it("ON_COMPLETE: approveFinish spawns the next occurrence; the job ignores ON_COMPLETE rules", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { title: "Weekly sync", recurrence: { frequency: "WEEKLY", interval: 1, trigger: "ON_COMPLETE" } });
    const ruleId = (await loadTask(id)).recurrenceRuleId!;
    await testDb.recurrenceRule.update({ where: { id: ruleId }, data: { nextRunAt: new Date(Date.now() - 3_600_000) } });
    const { run } = await import("@/jobs/recurrence");
    expect((await run()).created).toBe(0);
    await testDb.recurrenceRule.update({ where: { id: ruleId }, data: { nextRunAt: new Date((await loadTask(id)).scheduledStart!.getTime() + 7 * DAY) } });

    const lc = await import("@/server/tasks/lifecycle");
    session.set(tl);
    await lc.startTask(id);
    session.set(admin);
    expect((await lc.approveFinish(id)).ok).toBe(true);

    const tasks = await testDb.task.findMany({ where: { recurrenceRuleId: ruleId }, orderBy: { createdAt: "asc" } });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe("COMPLETED");
    const next = tasks[1];
    expect(next.parentTaskId).toBe(id);
    expect(next.status).toBe("ASSIGNED");
    expect(next.scheduledStart!.getTime()).toBeGreaterThan(Date.now());
    expect(next.scheduledStart!.getTime()).toBeGreaterThanOrEqual(tasks[0].scheduledStart!.getTime() + 7 * DAY);
    expect(dateKey(next.scheduledStart!, TZ)).toBe(dateKey(new Date(tasks[0].scheduledStart!.getTime() + 7 * DAY), TZ));
    const rule = await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: ruleId } });
    expect(rule.nextRunAt!.getTime()).toBeGreaterThan(next.scheduledStart!.getTime());

    // approving the occurrence spawns a third one
    session.set(tl);
    await lc.startTask(next.id);
    session.set(admin);
    expect((await lc.approveFinish(next.id)).ok).toBe(true);
    expect(await testDb.task.count({ where: { recurrenceRuleId: ruleId } })).toBe(3);
  });

  it("endDate in the past: nextRunAt is null at creation, completion stops the rule and creates nothing", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const yesterday = dateKey(new Date(Date.now() - DAY), TZ);
    const id = await createTaskAs(client.id, [tl.id], { title: "Ended", recurrence: { frequency: "DAILY", interval: 1, trigger: "ON_COMPLETE", endDate: yesterday } });
    const t = await loadTask(id);
    expect(t.recurrenceRule!.endDate).not.toBeNull();
    expect(t.recurrenceRule!.nextRunAt).toBeNull();

    const lc = await import("@/server/tasks/lifecycle");
    session.set(tl);
    await lc.startTask(id);
    session.set(admin);
    expect((await lc.approveFinish(id)).ok).toBe(true);
    const rule = await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: t.recurrenceRuleId! } });
    expect(rule.stopped).toBe(true);
    expect(await testDb.task.count({ where: { recurrenceRuleId: rule.id } })).toBe(1);

    // a stopped rule is ignored by the job even if nextRunAt is forced into the past
    await testDb.recurrenceRule.update({ where: { id: rule.id }, data: { nextRunAt: new Date(Date.now() - DAY), trigger: "ON_SCHEDULE" } });
    const { run } = await import("@/jobs/recurrence");
    expect((await run()).created).toBe(0);
  });

  it("stopRecurrence prevents further occurrences", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { title: "Stop me", recurrence: { frequency: "DAILY", interval: 1, trigger: "ON_SCHEDULE" } });
    const ruleId = (await loadTask(id)).recurrenceRuleId!;
    const { stopRecurrence, spawnNextOccurrence } = await import("@/server/tasks/recurring");
    await stopRecurrence(ruleId);
    await testDb.recurrenceRule.update({ where: { id: ruleId }, data: { nextRunAt: new Date(Date.now() - DAY) } });
    const { run } = await import("@/jobs/recurrence");
    expect((await run()).created).toBe(0);
    expect(await spawnNextOccurrence(id, admin.id)).toBeNull();
    expect(await testDb.task.count({ where: { recurrenceRuleId: ruleId } })).toBe(1);
  });
});
