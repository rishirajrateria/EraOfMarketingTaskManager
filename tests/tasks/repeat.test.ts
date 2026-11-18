import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, addYears } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, loadTask, settle } from "./helpers";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { addDaysKey, defaultRule, describeRule, nextDate, repeatPresets, weekdayOf } from "@/server/tasks/repeat-rule";

const session = mockSession();
const TZ = "Asia/Kolkata";
const iso = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
/** 11:00 IST on the calendar day `key` (company timezone). */
const at11 = (key: string) => zonedDayAt(parseDateKey(key, TZ), 11 * 60, TZ);

describe("repeat rules on tasks (ADR 0010)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("each Quick-pick preset persists its rule and the second occurrence's due time", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const today = dateKey(new Date(), TZ); // computed in Asia/Kolkata, not the host timezone
    const base = addDaysKey(today, 10);
    const start = at11(base);
    for (const p of repeatPresets(base)) {
      const recurrence = { ...defaultRule(base), ...p.patch };
      const id = await createTaskAs(client.id, [tl.id], { title: p.label, scheduledStart: iso(start), recurrence });
      const t = await loadTask(id);
      const r = t.recurrenceRule!;
      expect(r.repeatFreq, p.label).toBe(p.patch.freq);
      expect(r.anchorDate, p.label).toBe(base);
      expect(r.trigger).toBe("ON_SCHEDULE");
      const expected = nextDate({ ...recurrence, anchor: base }, base, 1)!;
      expect(dateKey(r.nextRunAt!, TZ), p.label).toBe(expected);
      expect(formatInTimeZone(r.nextRunAt!, TZ, "HH:mm"), p.label).toBe("11:00");
      expect(describeRule({ ...recurrence, anchor: base })).not.toBe("");
    }
    const byTitle = async (title: string) => (await testDb.task.findFirstOrThrow({ where: { title }, include: { recurrenceRule: true } })).recurrenceRule!;
    expect(dateKey((await byTitle("Every day")).nextRunAt!, TZ)).toBe(addDaysKey(base, 1));
    expect(dateKey((await byTitle("Every 2 weeks")).nextRunAt!, TZ)).toBe(addDaysKey(base, 14));
    expect((await byTitle("Every 2 weeks")).byWeekday).toEqual([weekdayOf(base)]);
    expect(dateKey((await byTitle("Every year")).nextRunAt!, TZ)).toBe(dateKey(addYears(start, 1), TZ));
    const weekday = await byTitle("Every weekday");
    expect([1, 2, 3, 4, 5]).toContain(toZonedTime(weekday.nextRunAt!, TZ).getDay());
    const last = await byTitle("Every month, last day");
    expect(last.monthDay).toBe(32);
    const lastKey = dateKey(last.nextRunAt!, TZ);
    expect(dateKey(addDays(parseDateKey(lastKey, TZ), 1), TZ).endsWith("-01")).toBe(true);
  });

  it("the job creates the next occurrence on the rule's next day (weekly Mon + Wed), then stops after N times", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    // Monday two weeks ago (IST) at 11:00 → the rule's next occurrence is that Wednesday, already due.
    const today = dateKey(new Date(), TZ);
    let monday = addDaysKey(today, -14);
    while (weekdayOf(monday) !== 1) monday = addDaysKey(monday, -1);
    const wednesday = addDaysKey(monday, 2);
    const id = await createTaskAs(client.id, [tl.id], {
      title: "Standup notes",
      scheduledStart: iso(at11(monday)),
      recurrence: { freq: "WEEKLY", interval: 1, days: [1, 3], ends: "COUNT", count: 3 },
    });
    const ruleId = (await loadTask(id)).recurrenceRuleId!;
    expect((await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: ruleId } })).nextRunAt!.toISOString()).toBe(at11(wednesday).toISOString());

    const { run } = await import("@/jobs/recurrence");
    expect((await run()).created).toBe(1);
    const second = await testDb.task.findFirstOrThrow({ where: { recurrenceRuleId: ruleId, id: { not: id } } });
    expect(second.scheduledStart!.toISOString()).toBe(at11(wednesday).toISOString());
    const nextMonday = addDaysKey(monday, 7);
    expect((await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: ruleId } })).nextRunAt!.toISOString()).toBe(at11(nextMonday).toISOString());

    // third (and last) occurrence: next Monday; afterwards the rule has no next run
    expect((await run()).created).toBe(1);
    expect(await testDb.task.count({ where: { recurrenceRuleId: ruleId } })).toBe(3);
    expect((await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: ruleId } })).nextRunAt).toBeNull();
    expect((await run()).created).toBe(0);
  });

  it("monthly on the last Friday: the job schedules the occurrence on that day", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    // last Friday of the month two months ago (IST)
    const today = dateKey(new Date(), TZ);
    const [y, m] = today.split("-").map(Number);
    const firstOfMonth = `${m <= 2 ? y - 1 : y}-${String(((m - 3 + 12) % 12) + 1).padStart(2, "0")}-01`;
    const rule = { freq: "MONTHLY" as const, monthMode: "NTH" as const, nth: 5, nthDay: 5 };
    const anchor = nextDate({ ...defaultRule(firstOfMonth), ...rule, anchor: firstOfMonth }, addDaysKey(firstOfMonth, -1))!;
    expect(weekdayOf(anchor)).toBe(5);
    const id = await createTaskAs(client.id, [tl.id], { title: "Month-end report", scheduledStart: iso(at11(anchor)), recurrence: rule });
    const ruleId = (await loadTask(id)).recurrenceRuleId!;
    const { run } = await import("@/jobs/recurrence");
    expect((await run()).created).toBe(1);
    const second = await testDb.task.findFirstOrThrow({ where: { recurrenceRuleId: ruleId, id: { not: id } } });
    const secondKey = dateKey(second.scheduledStart!, TZ);
    expect(weekdayOf(secondKey)).toBe(5);
    expect(secondKey.slice(0, 7)).not.toBe(anchor.slice(0, 7));
    expect(Number(secondKey.slice(8))).toBeGreaterThan(21); // the last Friday is always after the 21st
    expect(dateKey(addDays(parseDateKey(secondKey, TZ), 7), TZ).slice(5, 7)).not.toBe(secondKey.slice(5, 7));
  });
});
