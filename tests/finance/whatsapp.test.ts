import { describe, it, expect, beforeEach } from "vitest";
import { isWhatsappMock, normalizeE164, sendWhatsapp, sentWhatsappLog } from "@/integrations/whatsapp";
import { publicInvoiceUrl } from "@/server/finance/links";

describe("whatsapp integration (mock mode)", () => {
  beforeEach(() => {
    sentWhatsappLog.length = 0;
  });

  it("normalises numbers to E.164", () => {
    expect(normalizeE164("+91 98765 43210")).toBe("+919876543210");
    expect(normalizeE164("919876543210")).toBe("+919876543210");
    expect(normalizeE164("98765 43210")).toBe("+919876543210"); // bare Indian mobile
    expect(normalizeE164("09876543210")).toBe("+919876543210");
    expect(normalizeE164("+1 (212) 555-0100")).toBe("+12125550100");
    expect(normalizeE164("12345")).toBeNull();
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164("+0123456789")).toBeNull();
  });

  it("records messages in the log and returns a mock sid; invalid numbers fail softly", async () => {
    expect(isWhatsappMock()).toBe(true);
    const ok = await sendWhatsapp({ to: "+91 98765 43210", body: "Hi", mediaUrl: "https://x.test/a.pdf" });
    expect(ok).toEqual({ ok: true, sid: "mock_wa_1" });
    expect(sentWhatsappLog).toEqual([{ to: "+919876543210", body: "Hi", mediaUrl: "https://x.test/a.pdf", at: expect.any(Date) }]);
    const bad = await sendWhatsapp({ to: "nope", body: "Hi" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/E\.164/);
    expect(sentWhatsappLog).toHaveLength(1);
  });

  it("public invoice links use PUBLIC_BASE_URL / AUTH_URL", () => {
    const prev = { pub: process.env.PUBLIC_BASE_URL, auth: process.env.AUTH_URL };
    process.env.PUBLIC_BASE_URL = "https://app.test/";
    expect(publicInvoiceUrl("abc")).toBe("https://app.test/api/public/invoice/abc");
    delete process.env.PUBLIC_BASE_URL;
    process.env.AUTH_URL = "http://localhost:3000";
    expect(publicInvoiceUrl("abc")).toBe("http://localhost:3000/api/public/invoice/abc");
    expect(publicInvoiceUrl(null)).toBeNull();
    if (prev.pub !== undefined) process.env.PUBLIC_BASE_URL = prev.pub;
    if (prev.auth !== undefined) process.env.AUTH_URL = prev.auth;
    else delete process.env.AUTH_URL;
  });
});
