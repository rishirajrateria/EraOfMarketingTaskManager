/**
 * Call / WhatsApp from the task card (prototype `contactSheet`, ADR 0017). Pure: who to offer and the links.
 * Rows: the client (its contact person's name when set) and the task's Team Leader — for a Team Leader viewer the
 * second row is the Admin instead. Calls prefer the phone, WhatsApp the WhatsApp number; each falls back to the other.
 */
export type ContactMode = "call" | "wa";
export type ContactPerson = { id?: string; name: string; phone?: string | null; whatsapp?: string | null };
export type ContactRow = {
  key: "client" | "lead" | "admin";
  label: string;
  name: string;
  number: string | null;
  href: string | null;
  /** Admin only, when there is no number: the client / person edit form to add one on the spot. */
  addHref: string | null;
};

/** Digits for tel: / wa.me — "+91 98300 11122" → "919830011122"; a bare 10-digit Indian mobile gets 91. */
export function phoneDigits(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (/^0[6-9]\d{9}$/.test(d)) d = d.slice(1);
  if (/^[6-9]\d{9}$/.test(d)) d = `91${d}`;
  return d.length >= 7 && d.length <= 15 ? d : null;
}

export const firstWord = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The number a mode uses: calls → phone, else WhatsApp; WhatsApp → WhatsApp, else phone. */
export function pickNumber(p: ContactPerson, mode: ContactMode): string | null {
  const order = mode === "call" ? [p.phone, p.whatsapp] : [p.whatsapp, p.phone];
  return order.find((x) => phoneDigits(x)) ?? null;
}

export function contactHref(mode: ContactMode, number: string | null, name: string, taskTitle: string): string | null {
  const d = phoneDigits(number);
  if (!d) return null;
  if (mode === "call") return `tel:+${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(`Hi ${firstWord(name)}, about “${taskTitle}”: `)}`;
}

/** A client's contact field may be a person's name or an email; only a name is used to greet. */
export const clientContactName = (c: { name: string; contact?: string | null }) => (c.contact && !c.contact.includes("@") ? c.contact.trim() : c.name);

export function contactRows(input: {
  mode: ContactMode;
  viewerRole: string;
  taskTitle: string;
  client: ContactPerson;
  teamLeader: ContactPerson | null;
  admin: ContactPerson | null;
}): ContactRow[] {
  const verb = input.mode === "call" ? "Call" : "WhatsApp";
  const row = (key: ContactRow["key"], who: string, p: ContactPerson): ContactRow => {
    const number = pickNumber(p, input.mode);
    const href = contactHref(input.mode, number, p.name, input.taskTitle);
    const addHref = href || input.viewerRole !== "ADMIN" || !p.id ? null : key === "client" ? `/admin/clients?edit=${p.id}` : `/admin/people?role=TEAM_LEADER&edit=${p.id}`;
    return { key, label: `${verb} ${who}`, name: p.name, number, href, addHref };
  };
  const rows = [row("client", "client", input.client)];
  if (input.viewerRole === "TEAM_LEADER") {
    if (input.admin) rows.push(row("admin", "Admin", input.admin));
  } else if (input.teamLeader) rows.push(row("lead", "team leader", input.teamLeader));
  return rows;
}

type PersonLite = { id: string; name: string; role: string; teamId: string | null; teamLeaderId: string | null; phone?: string | null };

/**
 * The people a card's sheet offers: the client, the Team Leader of the task's team (else an assignee's own Team
 * Leader, else an assignee who is one) and the Admin (the creator when an Admin, else the first Admin).
 */
export function taskContacts(
  t: { client: { id: string; name: string }; teams: { id: string }[]; assignees: { id: string }[]; createdById: string },
  data: { clients: { id: string; name: string; contact?: string | null; phone?: string | null; whatsapp?: string | null }[]; teams: { id: string; leaderId?: string | null }[]; people: PersonLite[] },
): { client: ContactPerson; teamLeader: ContactPerson | null; admin: ContactPerson | null } {
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const c: { name: string; contact?: string | null; phone?: string | null; whatsapp?: string | null } = data.clients.find((x) => x.id === t.client.id) ?? t.client;
  const assignees = t.assignees.map((a) => byId.get(a.id)).filter((p): p is PersonLite => !!p);
  const leadId =
    t.teams.map((x) => data.teams.find((tm) => tm.id === x.id)?.leaderId).find(Boolean) ??
    assignees.map((a) => a.teamLeaderId).find(Boolean) ??
    assignees.find((a) => a.role === "TEAM_LEADER")?.id;
  const lead = leadId ? byId.get(leadId) : undefined;
  const creator = byId.get(t.createdById);
  const admin = creator?.role === "ADMIN" ? creator : data.people.find((p) => p.role === "ADMIN");
  const person = (p: PersonLite | undefined) => (p ? { id: p.id, name: p.name, phone: p.phone ?? null } : null);
  return {
    client: { id: t.client.id, name: clientContactName(c), phone: c.phone ?? null, whatsapp: c.whatsapp ?? null },
    teamLeader: person(lead),
    admin: person(admin),
  };
}
