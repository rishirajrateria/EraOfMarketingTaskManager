import { describe, expect, it } from "vitest";
import {
  allowedContactIds,
  clientContactName,
  contactHref,
  contactRows,
  contactTargets,
  greetingName,
  mailBody,
  mailtoHref,
  phoneDigits,
  pickNumber,
  taskStaff,
  type ContactData,
  type ContactMode,
} from "@/components/dashboard/contacts";

const people = [
  { id: "a1", name: "Rishi Rateria", role: "ADMIN", teamId: null, teamLeaderId: null, phone: "+918910358506", email: "rishi@eom.in" },
  { id: "a2", name: "Other Admin", role: "ADMIN", teamId: null, teamLeaderId: null, phone: null, email: "other@eom.in" },
  { id: "tl", name: "Priya Sharma", role: "TEAM_LEADER", teamId: "t1", teamLeaderId: null, phone: null, email: "priya@eom.in" },
  { id: "ex", name: "Arjun Kumar", role: "EXECUTIVE", teamId: "t1", teamLeaderId: "tl", phone: "+919830066677", email: "arjun@eom.in" },
  { id: "ex2", name: "Dev Patel", role: "EXECUTIVE", teamId: "t1", teamLeaderId: "tl", phone: null, email: "dev@eom.in" },
  { id: "tl2", name: "Neha Rao", role: "TEAM_LEADER", teamId: "t2", teamLeaderId: null, phone: "+919830044455", email: "neha@eom.in" },
];
const data: ContactData = {
  clients: [{ id: "c1", name: "Zenith Foods", contact: "Mr Rao", phone: "+919876511111", whatsapp: null, emails: ["rao@zenith.in"] }],
  teams: [
    { id: "t1", leaderId: "tl" },
    { id: "t2", leaderId: "tl2" },
  ],
  people,
};
const task = {
  title: "Festive reel",
  client: { id: "c1", name: "Zenith Foods" },
  teams: [{ id: "t1" }],
  assignees: [{ id: "ex" }, { id: "ex2" }],
  createdById: "a1",
  scheduledStart: "2026-10-08T04:30:00.000Z", // 10:00am IST
  scheduledEnd: "2026-10-08T06:30:00.000Z", // 12:00pm IST
};
const viewers = {
  ADMIN: { id: "a1", role: "ADMIN", name: "Rishi Rateria" },
  TEAM_LEADER: { id: "tl", role: "TEAM_LEADER", name: "Priya Sharma" },
  EXECUTIVE: { id: "ex", role: "EXECUTIVE", name: "Arjun Kumar" },
};
const rows = (mode: ContactMode, viewer: (typeof viewers)[keyof typeof viewers], d: ContactData = data, t = task) =>
  contactRows({ mode, viewer, company: "Era Of Marketing", tz: "Asia/Kolkata", task: t, data: d });

describe("card Call / WhatsApp / Email links (ADR 0017)", () => {
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

  it("tel: and wa.me links with the greeting; a client without a contact person is greeted as a team", () => {
    expect(contactHref("call", "+91 98300 11122", "Priya", "Logo")).toBe("tel:+919830011122");
    const wa = contactHref("wa", "+91 98300 11122", "Priya", "Festive reel");
    expect(wa).toBe(`https://wa.me/919830011122?text=${encodeURIComponent("Hi Priya, about “Festive reel”: ")}`);
    expect(contactHref("wa", null, "Priya", "x")).toBeNull();
    expect(greetingName("lead", { name: "Priya Sharma" })).toBe("Priya");
    expect(greetingName("client", { name: "Mr Rao" }, { name: "Zenith", contact: "Mr Rao" })).toBe("Mr Rao"); // honorific kept with the name
    expect(greetingName("client", { name: "Sunita Rao" }, { name: "Robam", contact: "Sunita Rao" })).toBe("Sunita");
    expect(greetingName("client", { name: "Zenith" }, { name: "Zenith", contact: "accounts@zenith.in" })).toBe("Zenith team");
    expect(greetingName("client", { name: "Zenith" }, { name: "Zenith", contact: null })).toBe("Zenith team");
    expect(clientContactName({ name: "Zenith", contact: "accounts@zenith.in" })).toBe("Zenith");
  });
});

describe("who each role can contact (ADR 0017)", () => {
  it("picks the team's leader (else the assignee's), the creating Admin (else the first) and the task's executives", () => {
    expect(taskStaff(task, data)).toEqual({ leadId: "tl", adminId: "a1", execIds: ["ex", "ex2"] });
    expect(taskStaff({ ...task, teams: [], createdById: "ex" }, data)).toEqual({ leadId: "tl", adminId: "a1", execIds: ["ex", "ex2"] });
    expect(taskStaff({ ...task, createdById: "a2" }, data).adminId).toBe("a2");
  });

  it("Admin: client + Team Leader + one row per executive", () => {
    expect(contactTargets(task, data, viewers.ADMIN)).toEqual([
      { kind: "client", id: "c1" },
      { kind: "lead", id: "tl" },
      { kind: "exec", id: "ex" },
      { kind: "exec", id: "ex2" },
    ]);
    expect(rows("call", viewers.ADMIN).map((r) => r.label)).toEqual(["Call client", "Call team leader", "Call executive", "Call executive"]);
  });

  it("Team Leader: Admin + the executives — never the client, never themself", () => {
    const tl = contactTargets(task, data, viewers.TEAM_LEADER);
    expect(tl).toEqual([
      { kind: "admin", id: "a1" },
      { kind: "exec", id: "ex" },
      { kind: "exec", id: "ex2" },
    ]);
    for (const mode of ["call", "wa", "mail"] as const) expect(rows(mode, viewers.TEAM_LEADER).some((r) => r.kind === "client")).toBe(false);
    // a TL assigned to the task themself is still not listed
    expect(contactTargets({ ...task, assignees: [{ id: "tl" }, { id: "ex" }] }, data, viewers.TEAM_LEADER).map((x) => x.id)).toEqual(["a1", "ex"]);
  });

  it("Executive: their Team Leader + Admin — not the client, not themself, not other executives", () => {
    expect(contactTargets(task, data, viewers.EXECUTIVE)).toEqual([
      { kind: "lead", id: "tl" },
      { kind: "admin", id: "a1" },
    ]);
    // their own Team Leader even on another team's task
    expect(contactTargets({ ...task, teams: [{ id: "t2" }] }, data, viewers.EXECUTIVE)[0]).toEqual({ kind: "lead", id: "tl" });
    expect(rows("wa", viewers.EXECUTIVE).map((r) => [r.label, r.name])).toEqual([
      ["WhatsApp team leader", "Priya Sharma"],
      ["WhatsApp Admin", "Rishi Rateria"],
    ]);
  });

  it("the people whose details the server may send = everyone on the viewer's sheets", () => {
    const tasks = [task, { ...task, teams: [{ id: "t2" }], assignees: [{ id: "ex" }] }];
    expect([...allowedContactIds(tasks, data, viewers.TEAM_LEADER)].sort()).toEqual(["a1", "ex", "ex2"]);
    expect([...allowedContactIds(tasks, data, viewers.EXECUTIVE)].sort()).toEqual(["a1", "tl"]);
    expect([...allowedContactIds(tasks, data, viewers.ADMIN)].sort()).toEqual(["ex", "ex2", "tl", "tl2"]);
  });

  it("missing number / email → greyed row; Admin gets the right form to add it, nobody else does", () => {
    const call = rows("call", viewers.ADMIN);
    expect(call.map((r) => [r.key, r.href, r.addHref])).toEqual([
      ["client:c1", "tel:+919876511111", null],
      ["lead:tl", null, "/admin/people?role=TEAM_LEADER&edit=tl"],
      ["exec:ex", "tel:+919830066677", null],
      ["exec:ex2", null, "/admin/people?role=EXECUTIVE&edit=ex2"],
    ]);
    const noMail = { ...data, clients: [{ ...data.clients[0]!, emails: [] }] };
    const mail = rows("mail", viewers.ADMIN, noMail);
    expect(mail[0]).toMatchObject({ kind: "client", href: null, detail: null, addHref: "/admin/clients?edit=c1" });
    expect(rows("call", viewers.EXECUTIVE).map((r) => r.addHref)).toEqual([null, null]);
    expect(rows("mail", viewers.TEAM_LEADER).every((r) => r.href?.startsWith("mailto:"))).toBe(true);
  });
});

describe("Email: pre-written mailto (ADR 0017)", () => {
  const decode = (href: string) => {
    const [to, query] = href.slice("mailto:".length).split("?");
    const q = new URLSearchParams(query!.replace(/\+/g, "%2B"));
    return { to: decodeURIComponent(to!), subject: q.get("subject"), body: q.get("body") };
  };

  it("client: subject = the task title; body greets the contact person; signed by the viewer and the company", () => {
    const client = rows("mail", viewers.ADMIN)[0]!;
    expect(client.detail).toBe("rao@zenith.in");
    expect(client.href).toMatch(/^mailto:rao@zenith\.in\?subject=/);
    expect(decode(client.href!)).toEqual({
      to: "rao@zenith.in",
      subject: "Festive reel",
      body: "Hi Mr Rao,\n\nRegarding “Festive reel” — scheduled 08 Oct, 10:00am–12:00pm.\n\n\n\nThanks,\nRishi Rateria\nEra Of Marketing",
    });
  });

  it("staff: '[Client] title' and '(Client)' in the body; a client without a contact person → 'Hi <Client> team,'", () => {
    const tlMail = rows("mail", viewers.ADMIN)[1]!;
    expect(decode(tlMail.href!)).toEqual({
      to: "priya@eom.in",
      subject: "[Zenith Foods] Festive reel",
      body: "Hi Priya,\n\nRegarding “Festive reel” (Zenith Foods) — scheduled 08 Oct, 10:00am–12:00pm.\n\n\n\nThanks,\nRishi Rateria\nEra Of Marketing",
    });
    const noContact = { ...data, clients: [{ ...data.clients[0]!, contact: null }] };
    expect(decode(rows("mail", viewers.ADMIN, noContact)[0]!.href!).body).toMatch(/^Hi Zenith Foods team,\n\n/);
  });

  it("encodes the subject and body (spaces, &, ?, #, quotes, newlines) and rejects bad addresses", () => {
    const m = { greet: "Priya", staff: true, clientName: "A&B Co", taskTitle: "Q&A? #1 50% off", start: null, end: null, tz: "Asia/Kolkata", viewerName: "Rishi", company: "EOM" };
    const href = mailtoHref({ ...m, to: " priya@eom.in " })!;
    expect(href).not.toMatch(/\s/);
    expect(href).toContain("subject=%5BA%26B%20Co%5D%20Q%26A%3F%20%231%2050%25%20off&body=");
    expect(href).toContain("%0A");
    expect(decode(href).body).toBe("Hi Priya,\n\nRegarding “Q&A? #1 50% off” (A&B Co).\n\n\n\nThanks,\nRishi\nEOM");
    expect(mailtoHref({ ...m, to: "not-an-email" })).toBeNull();
    expect(mailtoHref({ ...m, to: null })).toBeNull();
    expect(mailBody({ ...m, staff: false, start: "2026-10-08T04:30:00.000Z", end: null })).toContain("— scheduled 08 Oct, 10:00am.");
  });
});
