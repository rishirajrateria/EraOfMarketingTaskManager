import { describe, it, expect } from "vitest";
import { grantIsActive, grantExpiresAt, grantMillisLeft, describeExpiry, fmtDuration } from "@/server/vault/access";

const now = new Date("2026-09-10T10:00:00Z");
const min = (n: number) => new Date(now.getTime() + n * 60_000);
const base = { revoked: false, expiresAt: null, expiresAfterFirstOpenMinutes: null, firstOpenedAt: null };

describe("grantIsActive", () => {
  it("is active with no expiry rules", () => {
    expect(grantIsActive(base, now)).toBe(true);
  });
  it("is inactive when revoked, regardless of dates", () => {
    expect(grantIsActive({ ...base, revoked: true }, now)).toBe(false);
    expect(grantIsActive({ ...base, revoked: true, expiresAt: min(60) }, now)).toBe(false);
  });
  it("absolute expiry: active before, inactive at/after", () => {
    expect(grantIsActive({ ...base, expiresAt: min(1) }, now)).toBe(true);
    expect(grantIsActive({ ...base, expiresAt: now }, now)).toBe(false);
    expect(grantIsActive({ ...base, expiresAt: min(-1) }, now)).toBe(false);
  });
  it("after-first-open: active until opened + minutes", () => {
    expect(grantIsActive({ ...base, expiresAfterFirstOpenMinutes: 10 }, now)).toBe(true); // not opened yet
    expect(grantIsActive({ ...base, expiresAfterFirstOpenMinutes: 10, firstOpenedAt: min(-5) }, now)).toBe(true);
    expect(grantIsActive({ ...base, expiresAfterFirstOpenMinutes: 10, firstOpenedAt: min(-10) }, now)).toBe(false);
    expect(grantIsActive({ ...base, expiresAfterFirstOpenMinutes: 1, firstOpenedAt: min(-5) }, now)).toBe(false);
  });
  it("both rules: the earliest one wins", () => {
    const both = { ...base, expiresAt: min(60), expiresAfterFirstOpenMinutes: 10, firstOpenedAt: min(-5) };
    expect(grantIsActive(both, now)).toBe(true);
    expect(grantIsActive(both, min(6))).toBe(false); // window closes at +5
    const absFirst = { ...base, expiresAt: min(2), expiresAfterFirstOpenMinutes: 60, firstOpenedAt: now };
    expect(grantIsActive(absFirst, min(3))).toBe(false);
  });
  it("accepts ISO strings for dates", () => {
    expect(grantIsActive({ ...base, expiresAt: min(5).toISOString() }, now)).toBe(true);
    expect(grantIsActive({ ...base, expiresAfterFirstOpenMinutes: 1, firstOpenedAt: min(-2).toISOString() }, now)).toBe(false);
  });
  it("defaults `now` to the current time", () => {
    expect(grantIsActive({ ...base, expiresAt: new Date(Date.now() + 60_000) })).toBe(true);
    expect(grantIsActive({ ...base, expiresAt: new Date(Date.now() - 60_000) })).toBe(false);
  });
});

describe("grantExpiresAt", () => {
  it("returns null with no rules or an unopened after-first-open window", () => {
    expect(grantExpiresAt(base)).toBeNull();
    expect(grantExpiresAt({ ...base, expiresAfterFirstOpenMinutes: 30 })).toBeNull();
  });
  it("returns the absolute expiry", () => {
    expect(grantExpiresAt({ ...base, expiresAt: min(5) })?.toISOString()).toBe(min(5).toISOString());
  });
  it("returns firstOpenedAt + minutes", () => {
    expect(grantExpiresAt({ ...base, expiresAfterFirstOpenMinutes: 15, firstOpenedAt: now })?.toISOString()).toBe(min(15).toISOString());
  });
  it("returns the earlier of both", () => {
    expect(grantExpiresAt({ ...base, expiresAt: min(5), expiresAfterFirstOpenMinutes: 15, firstOpenedAt: now })?.toISOString()).toBe(min(5).toISOString());
    expect(grantExpiresAt({ ...base, expiresAt: min(50), expiresAfterFirstOpenMinutes: 15, firstOpenedAt: now })?.toISOString()).toBe(min(15).toISOString());
  });
  it("ignores revoked (pure expiry calculation)", () => {
    expect(grantExpiresAt({ ...base, revoked: true, expiresAt: min(5) })?.toISOString()).toBe(min(5).toISOString());
  });
});

describe("helpers", () => {
  it("grantMillisLeft", () => {
    expect(grantMillisLeft(base, now)).toBeNull();
    expect(grantMillisLeft({ ...base, expiresAt: min(2) }, now)).toBe(120_000);
    expect(grantMillisLeft({ ...base, expiresAt: min(-2) }, now)).toBe(0);
  });
  it("fmtDuration", () => {
    expect(fmtDuration(45_000)).toBe("45s");
    expect(fmtDuration(125_000)).toBe("2m 05s");
    expect(fmtDuration(3_720_000)).toBe("1h 2m");
    expect(fmtDuration(90_000_000)).toBe("1d 1h");
  });
  it("describeExpiry", () => {
    expect(describeExpiry(base, now)).toBe("No expiry");
    expect(describeExpiry({ ...base, revoked: true }, now)).toBe("Revoked");
    expect(describeExpiry({ ...base, expiresAt: min(-1) }, now)).toBe("Expired");
    expect(describeExpiry({ ...base, expiresAfterFirstOpenMinutes: 30 }, now)).toBe("30m 00s after first open");
    expect(describeExpiry({ ...base, expiresAt: min(2) }, now)).toBe("Expires in 2m 00s");
    expect(describeExpiry({ ...base, expiresAt: min(2), expiresAfterFirstOpenMinutes: 30 }, now)).toBe("Expires in 2m 00s · 30m 00s after first open");
  });
});
