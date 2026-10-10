"use server";
/**
 * Review per pill (ADR 0015). Team Leaders / Executives request a review of a task's start date, start time or time
 * allotted (red dot on that pill + a REVIEW request with `field` in Admin's inbox) and may withdraw it; Admin marks it
 * reviewed (dot gone, request resolved) or flags a pill himself. All actions are idempotent.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, can, ForbiddenError, type SessionUser } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, adminIds, publishTaskChanged } from "@/lib/notify";
import { bus } from "@/lib/events";
import { safeRevalidate } from "@/lib/revalidate";
import { canView } from "@/server/tasks/queries";
import { REVIEW_FIELDS, REVIEW_FIELD_NAME, reviewFieldsOf, withField, type ReviewField } from "@/server/tasks/review-fields";

const fieldSchema = z.enum(REVIEW_FIELDS);
const noteSchema = z.string().max(2000);

async function loadFor(user: SessionUser, taskId: string) {
  if (!(await canView(user, taskId))) throw new ForbiddenError("Task not visible");
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, title: true, status: true, deletedAt: true, reviewFields: true, reviewRequested: true, assignees: { select: { userId: true } } } });
  if (!t || t.deletedAt) throw new Error("Task not found");
  return t;
}

async function setFields(taskId: string, fields: ReviewField[], note?: string | null) {
  await prisma.task.update({
    where: { id: taskId },
    data: { reviewFields: fields, reviewRequested: fields.length > 0, ...(fields.length ? (note !== undefined ? { reviewNote: note } : {}) : { reviewNote: null }) },
  });
}

function changed(taskId: string) {
  void publishTaskChanged(taskId);
  bus.publish({ type: "requests.changed" });
  safeRevalidate("/dashboard", "/requests");
}

/**
 * Team Leader / Executive (own tasks): "Request review of the <field>" with a note. Admin: "Flag the <field> for
 * review" (just the dot, no request). Asking again for a flagged pill changes nothing.
 */
export async function requestPillReview(taskId: string, rawField: string, rawNote = ""): Promise<ActionResult<{ fields: ReviewField[] }>> {
  return wrap(async () => {
    const field = fieldSchema.parse(rawField);
    const note = noteSchema.parse(rawNote).trim();
    const user = await requireUser();
    if (user.role !== "ADMIN" && !can.raiseReview(user)) throw new ForbiddenError();
    const t = await loadFor(user, taskId);
    if (t.status === "COMPLETED") throw new Error("This task is completed");
    if (user.role === "EXECUTIVE" && !t.assignees.some((a) => a.userId === user.id)) throw new ForbiddenError("Own tasks only");
    const current = reviewFieldsOf(t);
    if (current.includes(field)) return { fields: current };
    const fields = withField(current, field, true);
    await setFields(t.id, fields, user.role === "ADMIN" ? undefined : note || null);
    if (user.role !== "ADMIN") {
      await prisma.request.create({ data: { type: "REVIEW", field, taskId: t.id, raisedById: user.id, targetRole: "ADMIN", note } });
      await notify({ userIds: await adminIds(), kind: "REVIEW_REQUESTED", title: `Review the ${REVIEW_FIELD_NAME[field]}: ${t.title}`, body: note, href: "/requests", taskId: t.id });
    }
    await audit(user.id, user.role === "ADMIN" ? "task.flag_review" : "task.request_review", "Task", t.id, { reviewFields: current }, { reviewFields: fields, field, note });
    changed(t.id);
    return { fields };
  });
}

/** Team Leader / Executive: withdraw the review of a pill (their open request for it is resolved as withdrawn). */
export async function withdrawPillReview(taskId: string, rawField: string): Promise<ActionResult<{ fields: ReviewField[] }>> {
  return wrap(async () => {
    const field = fieldSchema.parse(rawField);
    const user = await requireUser();
    if (user.role === "ADMIN" || !can.raiseReview(user)) throw new ForbiddenError("Admin marks reviews as reviewed instead");
    const t = await loadFor(user, taskId);
    if (user.role === "EXECUTIVE" && !t.assignees.some((a) => a.userId === user.id)) throw new ForbiddenError("Own tasks only");
    const current = reviewFieldsOf(t);
    if (!current.includes(field)) return { fields: current };
    const fields = withField(current, field, false);
    await setFields(t.id, fields);
    await prisma.request.updateMany({
      where: { taskId: t.id, type: { in: ["REVIEW", "TIME_CHANGE"] }, field, status: "OPEN" },
      data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: new Date(), resolutionNote: "Withdrawn" },
    });
    await audit(user.id, "task.withdraw_review", "Task", t.id, { reviewFields: current }, { reviewFields: fields, field });
    changed(t.id);
    return { fields };
  });
}

/** Admin: "Mark the <field> reviewed" — removes the dot for everyone and resolves the open request(s) for it. */
export async function resolvePillReview(taskId: string, rawField: string, rawNote = ""): Promise<ActionResult<{ fields: ReviewField[] }>> {
  return wrap(async () => {
    const field = fieldSchema.parse(rawField);
    const note = noteSchema.parse(rawNote);
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new ForbiddenError();
    const t = await loadFor(user, taskId);
    const current = reviewFieldsOf(t);
    const fields = withField(current, field, false);
    if (fields.length !== current.length) await setFields(t.id, fields);
    const open = await prisma.request.findMany({ where: { taskId: t.id, type: { in: ["REVIEW", "TIME_CHANGE"] }, field, status: "OPEN" }, select: { id: true, raisedById: true } });
    if (open.length) {
      await prisma.request.updateMany({ where: { id: { in: open.map((r) => r.id) } }, data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: new Date(), resolutionNote: note || "Reviewed" } });
      const raisers = Array.from(new Set(open.map((r) => r.raisedById)));
      await notify({ userIds: raisers, kind: "GENERIC", title: `Reviewed: the ${REVIEW_FIELD_NAME[field]} of ${t.title}`, body: note, href: `/dashboard?task=${t.id}`, taskId: t.id, chat: false });
    }
    if (fields.length !== current.length || open.length) {
      await audit(user.id, "task.resolve_review", "Task", t.id, { reviewFields: current }, { reviewFields: fields, field, resolved: open.length });
      changed(t.id);
    }
    return { fields };
  });
}
