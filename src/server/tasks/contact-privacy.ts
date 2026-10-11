/**
 * What contact details a dashboard payload may carry (ADR 0017 "Privacy"). Pure, server-side.
 *  - Admin: every client's email / contact / phone / WhatsApp and every staff member's phone and email.
 *  - Team Leader: the Admin + the executives on the tasks they see. No client contact detail at all.
 *  - Executive: their Team Leader + the Admin. No client contact detail at all.
 * The people a viewer may contact are exactly the sheet's rows (`allowedContactIds` in `contacts.ts`), so the UI and
 * the payload can never disagree.
 */
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { allowedContactIds } from "@/components/dashboard/contacts";
import { clientGuestEmails } from "@/server/tasks/meeting";

type RawClient = { id: string; name: string; email: string | null; contact: string | null; phone: string | null; whatsapp: string | null };
type RawPerson = Omit<DashboardData["people"][number], "phone" | "email"> & { phone: string | null; email: string };
type Viewer = { id: string; role: string };

/** True when the viewer must not receive any client contact detail. */
export const hidesClientContact = (role: string) => role !== "ADMIN";

export function shapeClients(viewer: Viewer, clients: RawClient[]): DashboardData["clients"] {
  return clients.map((c) => {
    const emails = clientGuestEmails(c);
    if (hidesClientContact(viewer.role)) return { id: c.id, name: c.name, guestCount: emails.length };
    return { id: c.id, name: c.name, emails, guestCount: emails.length, contact: c.contact, phone: c.phone, whatsapp: c.whatsapp };
  });
}

export function shapePeople(
  viewer: Viewer,
  people: RawPerson[],
  tasks: Pick<TaskRow, "client" | "teams" | "assignees" | "createdById">[],
  teams: { id: string; leaderId?: string | null }[],
): DashboardData["people"] {
  const allowed = viewer.role === "ADMIN" ? null : allowedContactIds(tasks, { teams, people }, viewer);
  return people.map(({ phone, email, ...p }) => (!allowed || allowed.has(p.id) ? { ...p, phone, email } : p));
}

/** Meetings: a non-Admin row lists only the guests that are not the task client's own addresses (counted instead). */
export function splitClientGuests(guestEmails: string[], client: { email?: string | null; contact?: string | null }, hide: boolean) {
  if (!hide) return { guestEmails, clientGuestCount: 0 };
  const own = new Set(clientGuestEmails(client));
  const kept = guestEmails.filter((e) => !own.has(e.toLowerCase()));
  return { guestEmails: kept, clientGuestCount: guestEmails.length - kept.length };
}
