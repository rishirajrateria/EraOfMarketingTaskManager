import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { inboxCounts, inboxTotal } from "@/server/requests/areas";
import { baseState, urlBase64ToUint8Array } from "@/components/pwa/push-state";
import { whenTodayPhrase } from "@/lib/notification-text";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

async function fixtures() {
  const task = await testDb.task.create({ data: { title: "Reel", clientId: seed.client.id, createdById: seed.admin.id } });
  const leave = await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-11-02"), to: new Date("2026-11-03"), reason: "Trip" } });
  await testDb.request.createMany({
    data: [
      { type: "REVIEW", field: "mins", taskId: task.id, raisedById: seed.exec.id, targetRole: "ADMIN" },
      { type: "LEAVE", leaveId: leave.id, raisedById: seed.exec.id, targetRole: "HR" }, // pending leave: addressed to HR, in Admin's inbox
    ],
  });
  await testDb.invoice.create({ data: { number: "DRAFT-1", clientId: seed.client.id, status: "AWAITING_APPROVAL", subtotal: 100, gstAmount: 18, total: 118 } as never });
}

describe("header Requests badge (B1) and /api/badges (B3)", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    (await import("@/lib/settings")).invalidateSettingsCache();
  });
  afterEach(() => session.clear());

  it("Admin's badge equals the inbox tabs' total: work + pending leave + finance", async () => {
    await fixtures();
    const { requestBadgeCount, requestInbox } = await import("@/server/requests/inbox");
    const total = inboxTotal(inboxCounts(await requestInbox()));
    expect(total).toBe(3);
    expect(await requestBadgeCount("ADMIN")).toBe(total);
    expect(await requestBadgeCount("EXECUTIVE")).toBe(0);
  });

  it("GET /api/badges returns the true counts, and 401 when signed out", async () => {
    await fixtures();
    const { GET } = await import("@/app/api/badges/route");
    expect((await GET()).status).toBe(401);
    session.set(seed.admin);
    expect(await (await GET()).json()).toEqual({ unread: 0, requests: 3 });
    // resolving one request lowers the count — a "+1 per event" client could never show this
    await testDb.request.updateMany({ where: { type: "REVIEW" }, data: { status: "RESOLVED" } });
    expect((await (await GET()).json()).requests).toBe(2);
    await testDb.notification.create({ data: { userId: seed.admin.id, kind: "GENERIC", title: "x" } });
    expect((await (await GET()).json()).unread).toBe(1);
    session.set(seed.exec);
    expect((await (await GET()).json()).requests).toBe(0);
  });
});

describe("push state helpers (B2) and vault expiry text (B8)", () => {
  it("reports unsupported, unconfigured, blocked and ready", () => {
    const ok = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default", vapidKey: "k" };
    expect(baseState({ ...ok, hasPushManager: false })).toBe("unsupported");
    expect(baseState({ ...ok, vapidKey: "" })).toBe("unconfigured");
    expect(baseState({ ...ok, permission: "denied" })).toBe("denied");
    expect(baseState(ok)).toBe("checking");
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
  });

  it("expiry text is in the company timezone, not an ISO string", () => {
    const now = new Date("2026-10-12T08:00:00Z");
    expect(whenTodayPhrase(new Date("2026-10-12T09:45:00Z"), now, "Asia/Kolkata")).toBe("3:15pm today");
    expect(whenTodayPhrase(new Date("2026-10-13T09:45:00Z"), now, "Asia/Kolkata")).toBe("13 Oct, 3:15pm");
  });

  it("the vault job notifies with the formatted time", async () => {
    await resetDb();
    const s = await seedBasics();
    const now = new Date("2026-10-12T08:00:00Z");
    const item = await testDb.clientVaultItem.create({ data: { clientId: s.client.id, label: "Login", kind: "CREDENTIAL" } as never });
    await testDb.vaultAccessGrant.create({ data: { vaultItemId: item.id, userId: s.exec.id, grantedById: s.admin.id, expiresAt: new Date("2026-10-12T08:15:00Z") } as never });
    const { run } = await import("@/jobs/vault-expiry");
    expect((await run(now)).notified).toBe(1);
    const n = await testDb.notification.findFirstOrThrow({ where: { kind: "VAULT_ACCESS_EXPIRING" } });
    expect(n.body).toMatch(/expires at 1:\d\dpm today$/);
    expect(n.body).not.toMatch(/T\d\d:\d\d/);
  });
});
