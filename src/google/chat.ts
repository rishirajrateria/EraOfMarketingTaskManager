import { chat, isMock, mockId, withRetry } from "@/google/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { emailDomain } from "@/lib/domains";

export function spaceUrl(spaceName: string) {
  return `https://chat.google.com/room/${spaceName.replace(/^spaces\//, "")}`;
}

const errCode = (e: unknown) => (e as { code?: number }).code ?? (e as { response?: { status?: number } }).response?.status;
/** Google refused this member (outside the Workspace, external chat off, unknown user) — not worth retrying. */
const memberRefused = (e: unknown) => [400, 403, 404].includes(Number(errCode(e)));

export async function createSpace(displayName: string, memberEmails: string[], requestId: string) {
  if (isMock()) {
    const name = `spaces/${mockId("space", requestId)}`;
    return { name, url: spaceUrl(name) };
  }
  const setup = (emails: string[], rid: string) =>
    withRetry(() =>
      chat().spaces.setup({
        requestBody: {
          requestId: rid,
          space: { spaceType: "SPACE", displayName: displayName.slice(0, 128) },
          memberships: emails.map((email) => ({ member: { name: `users/${email}`, type: "HUMAN" } })),
        },
      }),
    );
  try {
    const name = (await setup(memberEmails, requestId)).data.name!;
    return { name, url: spaceUrl(name) };
  } catch (e) {
    // A member from another Google Workspace (e.g. the admin's own domain, ADR 0018) can make the whole setup fail.
    // Create the space with the organiser's-domain members, then try the others one by one (refusals are skipped).
    const home = emailDomain(env.impersonateUser);
    const inside = home ? memberEmails.filter((m) => emailDomain(m) === home) : memberEmails;
    if (!memberRefused(e) || inside.length === memberEmails.length) throw e;
    console.warn(`[chat] space setup refused (${e instanceof Error ? e.message : String(e)}); retrying with @${home} members only`);
    const name = (await setup(inside, `${requestId}-internal`)).data.name!;
    await addMembers(name, memberEmails.filter((m) => !inside.includes(m)));
    return { name, url: spaceUrl(name) };
  }
}

export async function addMembers(spaceName: string, emails: string[]) {
  if (isMock()) return;
  for (const email of emails) {
    await withRetry(() =>
      chat().spaces.members.create({
        parent: spaceName,
        requestBody: { member: { name: `users/${email}`, type: "HUMAN" } },
      }),
    ).catch((e: unknown) => {
      if (errCode(e) === 409) return; // already a member
      if (!memberRefused(e)) throw e;
      console.warn(`[chat] could not add ${email} to ${spaceName}: ${e instanceof Error ? e.message : String(e)}`);
    });
  }
}

export async function postMessage(spaceName: string, text: string) {
  if (isMock()) return;
  await withRetry(() => chat().spaces.messages.create({ parent: spaceName, requestBody: { text } }));
}

export async function deleteSpace(spaceName: string) {
  if (isMock()) return;
  await withRetry(() => chat().spaces.delete({ name: spaceName })).catch((e: unknown) => {
    if ((e as { code?: number }).code !== 404) throw e;
  });
}

/** Post a notification into the task's space if it has one (SPEC §10). */
export async function postTaskChatMessage(taskId: string, text: string) {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { chatSpaceId: true } });
  if (!t?.chatSpaceId) return;
  await postMessage(t.chatSpaceId, text);
}
