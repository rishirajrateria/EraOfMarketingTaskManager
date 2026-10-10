import { describe, expect, it } from "vitest";
import { clientContactName, contactHref, contactRows, phoneDigits, pickNumber, taskContacts } from "@/components/dashboard/contacts";

describe("card Call / WhatsApp links (ADR 0017)", () => {
  it("digits: E.164, spaces, a bare 10-digit Indian mobile, junk", () => {
    expect(phoneDigits("+91 98300 11122")).toBe("919830011122");
    expect(phoneDigits("9830011122")).toBe("919830011122");
    expect(phoneDigits("09830011122")).toBe("919830011122");
    expect(phoneDigits("+971 50 123 4567")).toBe("971501234567");
    expect(phoneDigits("12")).toBeNull();
    expect(phoneDigits(null)).toBeNull();
  });

  it("calls prefer the phone, WhatsApp prefers the WhatsApp number; each falls back to the other", () => {
    const both = { name: "Zenith", phone: "+91 98765 11111", whatsapp: "+919876522222" };
    expect(pickNumber(both, "call")).toBe("+91 98765 11111");
    expect(pickNumber(both, "wa")).toBe("+919876522222");
    expect(pickNumber({ name: "x", whatsapp: "+919876522222" }, "call")).toBe("+919876522222");
    expect(pickNumber({ name: "x", phone: "+919876511111" }, "wa")).toBe("+919876511111");
    expect(pickNumber({ name: "x", phone: "n/a" }, "wa")).toBeNull();
  });

  it("tel: and wa.me links with the greeting", () => {
    expect(contactHref("call", "+91 98300 11122", "Priya Sharma", "Logo")).toBe("tel:+919830011122");
    const wa = contactHref("wa", "+91 98300 11122", "Priya Sharma", "Festive reel");
    expect(wa).toBe(`https://wa.me/919830011122?text=${encodeURIComponent("Hi Priya, about “Festive reel”: ")}`);
    expect(contactHref("wa", null, "Priya", "x")).toBeNull();
  });

  it("role rule: Admin / Executive → client + team leader; Team Leader → client + Admin; no number → greyed row", () => {
    const base = { taskTitle: "Carousel", client: { name: "Zenith", phone: "+919876511111" }, teamLeader: { name: "Priya Sharma", phone: null }, admin: { name: "Rishi Rateria", phone: "+918910358506" } };
    const admin = contactRows({ ...base, mode: "call", viewerRole: "ADMIN" });
    expect(admin.map((r) => [r.key, r.label, r.href])).toEqual([
      ["client", "Call client", "tel:+919876511111"],
      ["lead", "Call team leader", null],
    ]);
    expect(contactRows({ ...base, mode: "wa", viewerRole: "EXECUTIVE" }).map((r) => r.key)).toEqual(["client", "lead"]);
    // Admin gets "Add number" on a row without one (opens the person's / client's form); nobody else does
    const withIds = { ...base, client: { id: "c1", name: "Zenith" }, teamLeader: { id: "tl", name: "Priya", phone: null } };
    expect(contactRows({ ...withIds, mode: "call", viewerRole: "ADMIN" }).map((r) => r.addHref)).toEqual(["/admin/clients?edit=c1", "/admin/people?role=TEAM_LEADER&edit=tl"]);
    expect(contactRows({ ...withIds, mode: "call", viewerRole: "EXECUTIVE" }).map((r) => r.addHref)).toEqual([null, null]);
    expect(contactRows({ ...base, client: { id: "c1", name: "Z", phone: "+919876511111" }, mode: "call", viewerRole: "ADMIN" })[0].addHref).toBeNull();
    const tl = contactRows({ ...base, mode: "wa", viewerRole: "TEAM_LEADER" });
    expect(tl.map((r) => [r.label, r.name])).toEqual([
      ["WhatsApp client", "Zenith"],
      ["WhatsApp Admin", "Rishi Rateria"],
    ]);
    expect(tl[1].href).toMatch(/^https:\/\/wa\.me\/918910358506\?text=Hi%20Rishi/);
  });

  it("picks the team's leader (else the assignee's), the creating Admin, and the client's contact person", () => {
    const people = [
      { id: "a1", name: "Rishi", role: "ADMIN", teamId: null, teamLeaderId: null, phone: "+918910358506" },
      { id: "a2", name: "Other Admin", role: "ADMIN", teamId: null, teamLeaderId: null, phone: null },
      { id: "tl", name: "Priya", role: "TEAM_LEADER", teamId: "t1", teamLeaderId: null, phone: "+919830011122" },
      { id: "ex", name: "Arjun", role: "EXECUTIVE", teamId: "t1", teamLeaderId: "tl", phone: null },
    ];
    const data = { clients: [{ id: "c1", name: "Zenith Foods", contact: "Mr Rao", phone: "+919876511111", whatsapp: null }], teams: [{ id: "t1", leaderId: "tl" }], people };
    const task = { client: { id: "c1", name: "Zenith Foods" }, teams: [{ id: "t1" }], assignees: [{ id: "ex" }], createdById: "a2" };
    const c = taskContacts(task, data);
    expect(c.client).toEqual({ id: "c1", name: "Mr Rao", phone: "+919876511111", whatsapp: null });
    expect(c.teamLeader).toEqual({ id: "tl", name: "Priya", phone: "+919830011122" });
    expect(c.admin).toEqual({ id: "a2", name: "Other Admin", phone: null }); // the Admin who created it
    expect(taskContacts({ ...task, teams: [], createdById: "ex" }, data).teamLeader?.name).toBe("Priya"); // via the assignee
    expect(taskContacts({ ...task, createdById: "ex" }, data).admin?.name).toBe("Rishi");
    expect(clientContactName({ name: "Zenith", contact: "accounts@zenith.in" })).toBe("Zenith");
  });
});
