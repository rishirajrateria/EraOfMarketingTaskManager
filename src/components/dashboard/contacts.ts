/**
 * Call / WhatsApp / Email from the task card (prototype `contactPeople` / `contactSheet`, ADR 0017). Pure: who each role
 * may contact, and the links. The server uses `allowedContactIds` to strip everyone else's details from the payload.
 *
 * Who (same list for all three buttons; the viewer is never listed):
 *  - Admin → the client, the task's Team Leader, each executive assigned to the task;
 *  - Team Leader → the Admin + each executive on the task (never the client);
 *  - Executive → their Team Leader + the Admin.
 */
import { formatInTimeZone } from "date-fns-tz";

export type ContactMode = "call" | "wa" | "mail";
export type ContactKind = "client" | "lead" | "admin" | "exec";
export type ContactPerson = { id?: string; name: string; phone?: string | null; whatsapp?: string | null; email?: string | null };
export type ContactTarget = { kind: ContactKind; id: string };
export type ContactRow = {
  key: string;
  kind: ContactKind;
  /** "Call client", "WhatsApp executive", "Email Admin". */
  label: string;
  name: string;
  /** The number (call / WhatsApp) or the address (email) the link uses. */
  detail: string | null;
  href: string | null;
  /** Admin only, when the number / email is missing: the client / person form to add it on the spot. */
  addHref: string | null;
};

type ClientLite = { id: string; name: string; contact?: string | null; phone?: string | null; whatsapp?: string | null; emails?: string[] };
type PersonLite = { id: string; name: string; role: string; teamId: string | null; teamLeaderId: string | null; phone?: string | null; email?: string | null };
type TaskLite = { client: { id: string; name: string }; teams: { id: string }[]; assignees: { id: string }[]; createdById: string };
type Viewer = { id: string; role: string };
export type ContactData = { clients: ClientLite[]; teams: { id: string; leaderId?: string | null }[]; people: PersonLite[] };

export const MODE_VERB: Record<ContactMode, string> = { call: "Call", wa: "WhatsApp", mail: "Email" };
const WHO: Record<ContactKind, string> = { client: "client", lead: "team leader", admin: "Admin", exec: "executive" };

/** Digits for tel: / wa.me — "+91 98300 11122" → "919830011122"; a bare 10-digit Indian mobile gets 91. */
export function phoneDigits(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (/^0[6-9]\d{9}$/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  return d.length >= 7 && d.length <= 15 ? d : null;
}

export const firstWord = (name: string) => name.trim().split(/\s+/)[0] || name;
const isEmail = (s: string | null | undefined): s is string => !!s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** The number a mode uses: calls → phone, else WhatsApp; WhatsApp → WhatsApp, else phone. */
export function pickNumber(p: ContactPerson, mode: Exclude<ContactMode, "mail">): string | null {
  const order = mode === "call" ? [p.phone, p.whatsapp] : [p.whatsapp, p.phone];
  return order.find((x) => phoneDigits(x)) ?? null;
}

/** A client's contact field may be a person's name or an email; only a name is used to greet. */
export const clientContactName = (c: { name: string; contact?: string | null }) => (c.contact && !c.contact.includes("@") ? c.contact.trim() : c.name);

const HONORIFIC = /^(mr|mrs|ms|miss|dr|shri|smt|sri)\.?$/i;

/** "Priya" for a person or a client's contact person ("Mr Rao" stays whole); "Repo team" for a client without one. */
export function greetingName(kind: ContactKind, person: { name: string }, client?: { name: string; contact?: string | null }): string {
  if (kind === "client" && client && clientContactName(client) === client.name) return `${client.name} team`;
  const words = person.name.trim().split(/\s+/);
  return HONORIFIC.test(words[0] ?? "") && words[1] ? `${words[0]} ${words[1]}` : firstWord(person.name);
}

export function contactHref(mode: Exclude<ContactMode, "mail">, number: string | null, greet: string, taskTitle: string): string | null {
  const d = phoneDigits(number);
  if (!d) return null;
  if (mode === "call") return `tel:+${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(`Hi ${greet}, about “${taskTitle}”: `)}`;
}

export type MailInput = {
  to: string | null | undefined;
  greet: string;
  /** Staff mail carries the client in the subject ("[Repo] …") and the body ("… (Repo)"); client mail does not. */
  staff: boolean;
  clientName: string;
  taskTitle: string;
  start: string | Date | null;
  end: string | Date | null;
  tz: string;
  viewerName: string;
  company: string;
};

/** The pre-written email body (prototype `contactSheet` mail). */
export function mailBody(m: Omit<MailInput, "to">): string {
  const t = (d: string | Date) => formatInTimeZone(new Date(d), m.tz, "h:mma").toLowerCase();
  const when = m.start ? ` — scheduled ${formatInTimeZone(new Date(m.start), m.tz, "dd MMM")}, ${t(m.start)}${m.end ? `–${t(m.end)}` : ""}` : "";
  const about = `Regarding “${m.taskTitle}”${m.staff ? ` (${m.clientName})` : ""}${when}.`;
  return `Hi ${m.greet},\n\n${about}\n\n\n\nThanks,\n${m.viewerName}${m.company ? `\n${m.company}` : ""}`;
}

/** mailto: with the subject (task title; staff: "[<Client>] <title>") and the body; null without a valid address. */
export function mailtoHref(m: MailInput): string | null {
  if (!isEmail(m.to)) return null;
  const subject = `${m.staff ? `[${m.clientName}] ` : ""}${m.taskTitle}`;
  const to = encodeURIComponent(m.to.trim()).replace(/%40/g, "@");
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailBody(m))}`;
}

/** The task's Team Leader (the team's leader, else an assignee's TL, else an assignee who is one), Admin and executives. */
export function taskStaff(t: TaskLite, data: Pick<ContactData, "teams" | "people">) {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const assignees = t.assignees.map((a) => byId.get(a.id)).filter((p): p is PersonLite => !!p);
  const leadId =
    t.teams.map((x) => data.teams.find((tm) => tm.id === x.id)?.leaderId).find(Boolean) ??
    assignees.map((a) => a.teamLeaderId).find(Boolean) ??
    assignees.find((a) => a.role === "TEAM_LEADER")?.id ??
    null;
  const creator = byId.get(t.createdById);
  const adminId = (creator?.role === "ADMIN" ? creator : data.people.find((p) => p.role === "ADMIN"))?.id ?? null;
  return { leadId, adminId, execIds: assignees.filter((a) => a.role === "EXECUTIVE").map((a) => a.id) };
}

/** Who the viewer may contact about this task, in sheet order. Ids only — safe to run on the server. */
export function contactTargets(t: TaskLite, data: Pick<ContactData, "teams" | "people">, viewer: Viewer): ContactTarget[] {
  const { leadId, adminId, execIds } = taskStaff(t, data);
  const staff = (kind: ContactKind, id: string | null | undefined): ContactTarget[] => (id ? [{ kind, id }] : []);
  const execs = execIds.flatMap((id) => staff("exec", id));
  let list: ContactTarget[];
  if (viewer.role === "ADMIN") list = [{ kind: "client", id: t.client.id }, ...staff("lead", leadId), ...execs];
  else if (viewer.role === "TEAM_LEADER") list = [...staff("admin", adminId), ...execs];
  else if (viewer.role === "EXECUTIVE") {
    // "Their" Team Leader: the executive's own, else the task's.
    const ownLead = data.people.find((p) => p.id === viewer.id)?.teamLeaderId;
    list = [...staff("lead", ownLead ?? leadId), ...staff("admin", adminId)];
  } else list = [];
  const seen = new Set<string>();
  return list.filter((x) => x.kind === "client" || (x.id !== viewer.id && !seen.has(x.id) && !!seen.add(x.id)));
}

/** Staff whose phone / email the viewer may receive: everyone they can contact on any of their tasks (server). */
export function allowedContactIds(tasks: TaskLite[], data: Pick<ContactData, "teams" | "people">, viewer: Viewer): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks) for (const x of contactTargets(t, data, viewer)) if (x.kind !== "client") ids.add(x.id);
  return ids;
}

const editHref = (kind: ContactKind, id: string, role: string) => (kind === "client" ? `/admin/clients?edit=${id}` : `/admin/people?role=${role}&edit=${id}`);

/** The sheet's rows for one mode. */
export function contactRows(input: {
  mode: ContactMode;
  viewer: Viewer & { name: string };
  company: string;
  tz: string;
  task: TaskLite & { title: string; scheduledStart: string | null; scheduledEnd: string | null };
  data: ContactData;
}): ContactRow[] {
  const { mode, viewer, task, data } = input;
  const client: ClientLite = data.clients.find((c) => c.id === task.client.id) ?? task.client;
  return contactTargets(task, data, viewer).flatMap((x): ContactRow[] => {
    const p = x.kind === "client" ? undefined : data.people.find((u) => u.id === x.id);
    if (x.kind !== "client" && !p) return [];
    const person: ContactPerson =
      x.kind === "client"
        ? { id: client.id, name: clientContactName(client), phone: client.phone, whatsapp: client.whatsapp, email: client.emails?.[0] ?? null }
        : { id: p!.id, name: p!.name, phone: p!.phone, email: p!.email };
    const greet = greetingName(x.kind, person, x.kind === "client" ? client : undefined);
    let detail: string | null;
    let href: string | null;
    if (mode === "mail") {
      detail = isEmail(person.email) ? person.email.trim() : null;
      href = mailtoHref({
        to: detail,
        greet,
        staff: x.kind !== "client",
        clientName: task.client.name,
        taskTitle: task.title,
        start: task.scheduledStart,
        end: task.scheduledEnd,
        tz: input.tz,
        viewerName: viewer.name,
        company: input.company,
      });
    } else {
      detail = pickNumber(person, mode);
      href = contactHref(mode, detail, greet, task.title);
    }
    const addHref = href || viewer.role !== "ADMIN" ? null : editHref(x.kind, x.id, p?.role ?? "EXECUTIVE");
    return [{ key: `${x.kind}:${x.id}`, kind: x.kind, label: `${MODE_VERB[mode]} ${WHO[x.kind]}`, name: person.name, detail: href ? detail : null, href, addHref }];
  });
}
