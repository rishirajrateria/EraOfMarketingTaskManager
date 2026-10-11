import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { NextRequest } from "next/server";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { settle } from "../tasks/helpers";
import { sentMailLog } from "@/google/gmail";

const session = mockSession();
const TZ = "Asia/Kolkata";
const DAY = 86_400_000;
const dayKey = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd");
const at = (key: string, hm: string) => fromZonedTime(`${key}T${hm}:00`, TZ);

type Seed = Awaited<ReturnType<typeof seedBasics>>;

async function task(seed: Seed, clientId: string, data: Record<string, unknown>) {
  const start = (data.scheduledStart as Date) ?? new Date(Date.now() + 2 * DAY);
  return testDb.task.create({
    data: {
      title: "t",
      clientId,
      createdById: seed.admin.id,
      allocatedMinutes: 90,
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 90 * 60_000),
      description: "INTERNAL NOTE: margin is thin",
      assignees: { create: [{ userId: seed.exec.id }] },
      ...data,
    } as never,
  });
}

const invoice = (clientId: string, data: Record<string, unknown>) =>
  testDb.invoice.create({ data: { clientId, subtotal: 1000, gstAmount: 180, gstPercent: 18, total: 1180, pdfData: Buffer.from("%PDF-1.4 test"), ...data } as never });

/** Every key of a JSON value, recursively. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
  }
  return out;
}

describe("client tracking link (/c/<token>)", () => {
  let seed: Seed;
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.companySettings.update({ where: { id: "default" }, data: { email: "hello@eom.test", phone: "+91 98300 11122" } });
    const { invalidateSettingsCache } = await import("@/lib/settings");
    invalidateSettingsCache();
    sentMailLog.length = 0;
  });
  afterEach(async () => {
    await settle(50);
  });

  it("a token is 128-bit hex, made once, and opens only an active client", async () => {
    const { ensurePortalToken, clientForToken, portalData } = await import("@/server/portal/portal");
    const token = await ensurePortalToken(seed.client.id);
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(await ensurePortalToken(seed.client.id)).toBe(token);
    expect((await clientForToken(token))?.id).toBe(seed.client.id);
    expect(await portalData("0".repeat(32))).toBeNull();
    expect(await portalData("../../etc")).toBeNull();
    await testDb.client.update({ where: { id: seed.client.id }, data: { active: false } });
    expect(await portalData(token)).toBeNull();
  });

  it("shows only that client's work, asks and invoices — no hours, times, staff, notes or other clients", async () => {
    const other = await testDb.client.create({ data: { name: "Other Co" } });
    const soon = dayKey(new Date(Date.now() + 3 * DAY));
    await task(seed, seed.client.id, { title: "Reels for Diwali", status: "STARTED", scheduledStart: at(soon, "11:00"), scheduledEnd: at(soon, "13:30") });
    await task(seed, seed.client.id, { title: "Logo refresh", status: "PAUSED" });
    await task(seed, seed.client.id, { title: "Landing page", doubtRaised: true });
    await task(seed, seed.client.id, { title: "Old banner", scheduledStart: new Date(Date.now() - 2 * DAY), scheduledEnd: new Date(Date.now() - 2 * DAY + 3600_000) });
    await task(seed, seed.client.id, { title: "Brochure", status: "COMPLETED" });
    await task(seed, seed.client.id, { title: "Kickoff call", type: "MEETING" });
    await task(seed, seed.client.id, { title: "Deleted one", deletedAt: new Date() });
    const due = at(soon, "19:00");
    await task(seed, seed.client.id, { title: "Send product photos", forClient: true, deadlineOnly: true, allocatedMinutes: 0, scheduledStart: due, scheduledEnd: due, assignees: { create: [{ userId: seed.admin.id }] } });
    await task(seed, other.id, { title: "OTHER CLIENT SECRET" });

    const sent = await invoice(seed.client.id, { number: "EOM/1", status: "SENT", approvedAt: new Date(), dueDate: new Date(Date.now() - 3 * DAY) });
    await testDb.payment.create({ data: { invoiceId: sent.id, amount: 180 } });
    const paid = await invoice(seed.client.id, { number: "EOM/2", status: "PAID", approvedAt: new Date() });
    await testDb.payment.create({ data: { invoiceId: paid.id, amount: 1180, receivedAt: new Date(Date.now() - DAY) } });
    await invoice(seed.client.id, { number: "DRAFT-1", status: "DRAFT" });
    await invoice(seed.client.id, { number: "AWAIT-1", status: "AWAITING_APPROVAL" });
    await invoice(seed.client.id, { number: "EOM/3", status: "CANCELLED", approvedAt: new Date() });
    await invoice(seed.client.id, { number: "EOM/4", status: "SCHEDULED", approvedAt: new Date() });
    await invoice(other.id, { number: "EOM/9", status: "SENT", approvedAt: new Date() });

    const { ensurePortalToken, portalData } = await import("@/server/portal/portal");
    const d = (await portalData(await ensurePortalToken(seed.client.id)))!;
    expect(d.clientName).toBe("Repo");
    expect(d.progress).toEqual({ done: 1, total: 5 });
    expect(d.asks).toEqual([{ title: "Send product photos", status: "Waiting for you", tone: "white", due: soon }]);
    const byTitle = Object.fromEntries(d.work.map((t) => [t.title, t]));
    expect(Object.keys(byTitle).sort()).toEqual(["Landing page", "Logo refresh", "Old banner", "Reels for Diwali"]);
    expect(byTitle["Reels for Diwali"]).toEqual({ title: "Reels for Diwali", status: "In progress", tone: "green", due: soon });
    expect(byTitle["Logo refresh"]).toMatchObject({ status: "On hold", tone: "yellow" });
    expect(byTitle["Landing page"]).toMatchObject({ status: "Query raised", tone: "purple" });
    expect(byTitle["Old banner"]).toMatchObject({ status: "Not started · overdue", tone: "red" });
    expect(d.finished).toEqual([expect.objectContaining({ title: "Brochure", status: "Done", tone: "grey" })]);
    expect(d.driveUrl).toBeNull(); // no kit yet → "being set up"
    expect(d.upcoming).toEqual([{ id: sent.id, label: "Invoice EOM/1", amount: "₹1,000.00", date: dayKey(new Date(Date.now() - 3 * DAY)), overdue: true }]);
    expect(d.paid).toEqual([{ id: paid.id, label: "Invoice EOM/2", amount: "₹1,180.00", date: dayKey(new Date(Date.now() - DAY)), overdue: false }]);
    expect(d.company).toEqual({ name: "Era Of Marketing", email: "hello@eom.test", phone: "+91 98300 11122" });

    // nothing time-, hour-, staff- or note-shaped anywhere in what the page gets
    const json = JSON.stringify(d);
    const keys = keysOf(d);
    for (const k of ["scheduledStart", "scheduledEnd", "allocatedMinutes", "actualStart", "actualEnd", "assignees", "description", "doubtNote", "createdById", "start", "end"]) expect(keys.has(k)).toBe(false);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // no instants, only days
    for (const s of ["Arush", "Rishi", "Admin", "INTERNAL NOTE", "OTHER CLIENT SECRET", "Other Co", "Kickoff call", "Deleted one", "DRAFT-1", "AWAIT-1", "EOM/3", "EOM/4", "EOM/9"]) expect(json).not.toContain(s);
  });

  it("links the kit's root Drive folder once the kit exists (no new folder)", async () => {
    const ids = { kitFolderId: "root1", kitBrandId: "b", kitCredentialsId: "c", kitSheetId: "s", kitWorkId: "w", kitReportsId: "r" };
    await testDb.client.update({ where: { id: seed.client.id }, data: ids });
    const { ensurePortalToken, portalData } = await import("@/server/portal/portal");
    expect((await portalData(await ensurePortalToken(seed.client.id)))!.driveUrl).toBe("https://drive.google.com/drive/folders/root1");
  });

  it("the PDF route serves only that client's issued invoices", async () => {
    const other = await testDb.client.create({ data: { name: "Other Co" } });
    const mine = await invoice(seed.client.id, { number: "EOM/1", status: "SENT", approvedAt: new Date() });
    const draft = await invoice(seed.client.id, { number: "DRAFT-1", status: "DRAFT" });
    const awaiting = await invoice(seed.client.id, { number: "AWAIT-1", status: "AWAITING_APPROVAL" });
    const theirs = await invoice(other.id, { number: "EOM/9", status: "SENT", approvedAt: new Date() });
    const { ensurePortalToken } = await import("@/server/portal/portal");
    const token = await ensurePortalToken(seed.client.id);
    const otherToken = await ensurePortalToken(other.id);
    const { GET } = await import("@/app/c/[token]/invoice/[id]/route");
    const get = (t: string, id: string) => GET(new Request(`http://localhost/c/${t}/invoice/${id}`), { params: Promise.resolve({ token: t, id }) });

    const ok = await get(token, mine.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("application/pdf");
    expect(ok.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(ok.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    for (const [t, id] of [[token, theirs.id], [token, draft.id], [token, awaiting.id], [otherToken, mine.id], ["0".repeat(32), mine.id], ["nope", mine.id]] as const) {
      expect((await get(t, id)).status).toBe(404);
    }
    expect((await get(otherToken, theirs.id)).status).toBe(200);
  });

  it("Admin: get / regenerate / email the link; others are refused", async () => {
    const { getPortalLink, regeneratePortalLink, emailPortalLink } = await import("@/server/clients/portal-link");
    session.set(seed.tl);
    expect((await getPortalLink(seed.client.id)).ok).toBe(false);
    session.set(seed.admin);
    const noEmail = await emailPortalLink(seed.client.id, {});
    expect(noEmail.ok || noEmail.error).toMatch(/no email/);
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "ceo@repo.test", contact: "Priya", whatsapp: "+919876543210" } });
    const first = await getPortalLink(seed.client.id);
    if (!first.ok) throw new Error(first.error);
    expect(first.data.url).toMatch(/\/c\/[a-f0-9]{32}$/);
    expect(first.data.messages.whatsapp).toContain(first.data.url);
    expect(first.data.messages.email).toMatch(/^Hi Priya,/);
    const renewed = await regeneratePortalLink(seed.client.id);
    if (!renewed.ok) throw new Error(renewed.error);
    expect(renewed.data.url).not.toBe(first.data.url);
    const { portalData } = await import("@/server/portal/portal");
    expect(await portalData(first.data.url.split("/c/")[1]!)).toBeNull(); // the old link stops working
    const mailed = await emailPortalLink(seed.client.id, {});
    expect(mailed.ok && mailed.data.to).toBe("ceo@repo.test");
    expect(sentMailLog).toEqual([expect.objectContaining({ to: "ceo@repo.test", sender: "default", subject: "Track your work with Era Of Marketing" })]);
  });

  it("middleware lets /c/<token> through without a session (noindex) and still gates the app", async () => {
    const { middleware } = await import("@/middleware");
    const open = middleware(new NextRequest("http://localhost/c/0123456789abcdef0123456789abcdef"));
    expect(open.headers.get("location")).toBeNull();
    expect(open.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const gated = middleware(new NextRequest("http://localhost/dashboard"));
    expect(gated.headers.get("location")).toContain("/login");
    const lookalike = middleware(new NextRequest("http://localhost/clients"));
    expect(lookalike.headers.get("location")).toContain("/login");
  });
});
