import { afterEach, describe, expect, it, vi } from "vitest";
import { domainHint, domainList, emailInDomains, hostedDomainParam, parseDomains, signInEmailAllowed } from "@/lib/domains";
import { assertWorkspaceEmail } from "@/server/admin/people";

/** ADR 0018: staff on theeraofmarketing.com, the admin on eraofmarketing.com. */
const STAFF = "theeraofmarketing.com";
const ADMIN = "eraofmarketing.com";

describe("workspace domains (ADR 0018)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["GOOGLE_WORKSPACE_DOMAIN", "GOOGLE_WORKSPACE_DOMAINS", "GOOGLE_FINANCE_SENDER"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.resetModules();
  });

  it("parseDomains: comma list, case, @ and duplicates", () => {
    expect(parseDomains(`${STAFF},${ADMIN}`)).toEqual([STAFF, ADMIN]);
    expect(parseDomains(" @TheEraOfMarketing.com , eraofmarketing.com ,", "theeraofmarketing.com")).toEqual([STAFF, ADMIN]);
    expect(parseDomains("", undefined, null)).toEqual([]);
    expect(parseDomains("a.com; b.com c.com")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("env: GOOGLE_WORKSPACE_DOMAIN takes a list, GOOGLE_WORKSPACE_DOMAINS is an alias; workspaceDomain is the first", async () => {
    process.env.GOOGLE_WORKSPACE_DOMAIN = `${STAFF},${ADMIN}`;
    delete process.env.GOOGLE_WORKSPACE_DOMAINS;
    vi.resetModules();
    let { env } = await import("@/lib/env");
    expect(env.workspaceDomains).toEqual([STAFF, ADMIN]);
    expect(env.workspaceDomain).toBe(STAFF);

    delete process.env.GOOGLE_WORKSPACE_DOMAIN;
    process.env.GOOGLE_WORKSPACE_DOMAINS = `${STAFF}, ${ADMIN}`;
    vi.resetModules();
    ({ env } = await import("@/lib/env"));
    expect(env.workspaceDomains).toEqual([STAFF, ADMIN]);

    process.env.GOOGLE_WORKSPACE_DOMAIN = STAFF;
    process.env.GOOGLE_WORKSPACE_DOMAINS = ADMIN;
    process.env.GOOGLE_FINANCE_SENDER = " Finance@TheEraOfMarketing.com ";
    vi.resetModules();
    ({ env } = await import("@/lib/env"));
    expect(env.workspaceDomains).toEqual([STAFF, ADMIN]);
    expect(env.financeSender).toBe("finance@theeraofmarketing.com");

    delete process.env.GOOGLE_WORKSPACE_DOMAIN;
    delete process.env.GOOGLE_WORKSPACE_DOMAINS;
    delete process.env.GOOGLE_FINANCE_SENDER;
    vi.resetModules();
    ({ env } = await import("@/lib/env"));
    expect(env.workspaceDomains).toEqual([]);
    expect(env.workspaceDomain).toBe("");
    expect(env.financeSender).toBe("");
  });

  it("sign-in: any listed domain, bootstrap admins always, others refused; hd only with one domain", () => {
    const domains = [STAFF, ADMIN];
    const ok = (email: string, bootstrapAdmins: string[] = []) => signInEmailAllowed(email, { domains, bootstrapAdmins });
    expect(ok("asha@theeraofmarketing.com")).toBe(true);
    expect(ok("Contact@EraOfMarketing.com")).toBe(true);
    expect(ok("someone@gmail.com")).toBe(false);
    expect(ok("x@sub.theeraofmarketing.com")).toBe(false);
    expect(ok("x@evil-theeraofmarketing.com")).toBe(false);
    expect(ok("owner@gmail.com", ["owner@gmail.com"])).toBe(true);
    expect(ok("")).toBe(false);
    expect(signInEmailAllowed("anyone@anywhere.com", { domains: [], bootstrapAdmins: [] })).toBe(true);

    expect(hostedDomainParam([STAFF])).toEqual({ hd: STAFF });
    expect(hostedDomainParam([STAFF, ADMIN])).toEqual({});
    expect(hostedDomainParam([])).toEqual({});
  });

  it("people form hint and invite rule accept either domain", () => {
    expect(domainList([STAFF])).toBe("@theeraofmarketing.com");
    expect(domainHint([STAFF, ADMIN])).toBe("Must end with @theeraofmarketing.com or @eraofmarketing.com");
    expect(domainList(["a.com", "b.com", "c.com"])).toBe("@a.com, @b.com or @c.com");
    expect(domainHint([])).toBeUndefined();
    expect(emailInDomains("a@ERAOFMARKETING.COM", [STAFF, ADMIN])).toBe(true);

    expect(() => assertWorkspaceEmail("asha@theeraofmarketing.com", [STAFF, ADMIN])).not.toThrow();
    expect(() => assertWorkspaceEmail("contact@eraofmarketing.com", [STAFF, ADMIN])).not.toThrow();
    expect(() => assertWorkspaceEmail("x@gmail.com", [STAFF, ADMIN])).toThrow("Email must end with @theeraofmarketing.com or @eraofmarketing.com");
    expect(() => assertWorkspaceEmail("x@gmail.com", [STAFF])).toThrow("Email must end with @theeraofmarketing.com");
    expect(() => assertWorkspaceEmail("x@gmail.com", [])).not.toThrow();
  });
});
