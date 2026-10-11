import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, settle } from "./helpers";
import { REVIEW_FIELD_NAME, fieldForKind, isReviewField, reviewFieldsOf, withField } from "@/server/tasks/review-fields";
import { pillReviewItems } from "@/components/dashboard/PillReviewSheet";

const session = mockSession();
const R = () => import("@/server/tasks/review");
const fieldsOf = async (id: string) => (await testDb.task.findUniqueOrThrow({ where: { id }, select: { reviewFields: true, reviewRequested: true } }));

describe("review fields (pure, ADR 0015)", () => {
  it("canonical order, legacy flag = time allotted, kinds map to pills", () => {
    expect(withField(["mins"], "date", true)).toEqual(["date", "mins"]);
    expect(withField(["date", "time", "mins"], "time", false)).toEqual(["date", "mins"]);
    expect(withField(["bogus", "time"], "time", true)).toEqual(["time"]);
    expect(reviewFieldsOf({ reviewFields: [], reviewRequested: true })).toEqual(["mins"]);
    expect(reviewFieldsOf({ reviewFields: [], reviewRequested: false })).toEqual([]);
    expect(fieldForKind("REVIEW")).toBe("mins");
    expect(fieldForKind("TIME_CHANGE")).toBe("time");
    expect(isReviewField("date")).toBe(true);
    expect(isReviewField("x")).toBe(false);
    expect(REVIEW_FIELD_NAME.mins).toBe("time allotted");
  });

  it("pill menu items per role", () => {
    const t = { reviewFields: ["date" as const], status: "ASSIGNED" as const, assignees: [{ id: "e1", name: "E", avatar: null }] };
    expect(pillReviewItems("ADMIN", t, "date", "a").map((i) => i.choice)).toEqual(["resolve", "change", "actions"]);
    expect(pillReviewItems("ADMIN", t, "time", "a").map((i) => i.choice)).toEqual(["flag", "actions"]);
    expect(pillReviewItems("TEAM_LEADER", t, "date", "tl").map((i) => i.choice)).toEqual(["withdraw", "actions"]);
    expect(pillReviewItems("TEAM_LEADER", t, "mins", "tl")[0]!.label).toBe("Request review of the time allotted");
    expect(pillReviewItems("EXECUTIVE", t, "time", "e1").map((i) => i.choice)).toEqual(["request", "actions"]);
    expect(pillReviewItems("EXECUTIVE", t, "time", "other").map((i) => i.choice)).toEqual(["actions"]);
  });
});

describe("review per pill — actions", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("Team Leader requests → dot + REVIEW request with the field; idempotent; Admin marks it reviewed", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id]);
    const r = await R();
    session.set(tl);
    expect(await r.requestPillReview(id, "date", "Monday please")).toEqual({ ok: true, data: { fields: ["date"] } });
    expect(await r.requestPillReview(id, "date", "again")).toEqual({ ok: true, data: { fields: ["date"] } }); // no duplicate
    expect(await r.requestPillReview(id, "mins")).toEqual({ ok: true, data: { fields: ["date", "mins"] } });
    expect(await fieldsOf(id)).toEqual({ reviewFields: ["date", "mins"], reviewRequested: true });
    const reqs = await testDb.request.findMany({ where: { taskId: id, type: "REVIEW" }, orderBy: { createdAt: "asc" } });
    expect(reqs.map((q) => [q.field, q.status, q.note])).toEqual([
      ["date", "OPEN", "Monday please"],
      ["mins", "OPEN", ""],
    ]);
    expect(await testDb.notification.count({ where: { taskId: id, kind: "REVIEW_REQUESTED", userId: admin.id } })).toBe(2);
    expect((await r.requestPillReview(id, "nope")).ok).toBe(false);
    expect((await r.resolvePillReview(id, "date")).ok).toBe(false); // Admin only

    session.set(admin);
    expect(await r.resolvePillReview(id, "date")).toEqual({ ok: true, data: { fields: ["mins"] } });
    expect(await r.resolvePillReview(id, "date")).toEqual({ ok: true, data: { fields: ["mins"] } }); // idempotent
    const date = await testDb.request.findFirstOrThrow({ where: { taskId: id, field: "date" } });
    expect(date.status).toBe("RESOLVED");
    expect(date.resolvedById).toBe(admin.id);
    expect(await r.resolvePillReview(id, "mins")).toEqual({ ok: true, data: { fields: [] } });
    expect(await fieldsOf(id)).toEqual({ reviewFields: [], reviewRequested: false });
  });

  it("withdraw by the Team Leader; Admin can flag a pill (no request); editing clears every dot", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id]);
    const r = await R();
    session.set(tl);
    await r.requestPillReview(id, "time", "after lunch");
    expect(await r.withdrawPillReview(id, "time")).toEqual({ ok: true, data: { fields: [] } });
    expect(await r.withdrawPillReview(id, "time")).toEqual({ ok: true, data: { fields: [] } });
    expect((await testDb.request.findFirstOrThrow({ where: { taskId: id, field: "time" } })).resolutionNote).toBe("Withdrawn");

    session.set(admin);
    expect((await r.withdrawPillReview(id, "time")).ok).toBe(false); // Admin marks reviewed instead
    expect(await r.requestPillReview(id, "time")).toEqual({ ok: true, data: { fields: ["time"] } });
    expect(await testDb.request.count({ where: { taskId: id, status: "OPEN" } })).toBe(0); // a flag is not a request
    const { updateTask } = await import("@/server/tasks/manage");
    expect((await updateTask({ id, title: "Renamed" })).ok).toBe(true);
    expect(await fieldsOf(id)).toEqual({ reviewFields: [], reviewRequested: false });
  });

  it("Executives: own tasks only; the inbox's Mark resolved clears that pill's dot only", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    session.set(tl);
    const own = await createTaskAs(client.id, [exec.id]);
    session.set(admin);
    const other = await createTaskAs(client.id, [tl.id]);
    const r = await R();
    session.set(exec);
    expect((await r.requestPillReview(other, "date")).ok).toBe(false);
    expect((await r.requestPillReview(own, "date")).ok).toBe(true);
    // the old long-press "time-change request" lands on the start-time pill
    const { raiseReviewRequest } = await import("@/server/tasks/lifecycle");
    expect((await raiseReviewRequest(own, "TIME_CHANGE", "later")).ok).toBe(true);
    expect((await fieldsOf(own)).reviewFields).toEqual(["date", "time"]);

    session.set(admin);
    const { resolveRequest } = await import("@/server/requests/actions");
    const time = await testDb.request.findFirstOrThrow({ where: { taskId: own, field: "time" } });
    expect((await resolveRequest(time.id, "RESOLVED")).ok).toBe(true);
    expect(await fieldsOf(own)).toEqual({ reviewFields: ["date"], reviewRequested: true });
  });
});
