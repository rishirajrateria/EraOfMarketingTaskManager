import { chat, isMock, mockId, withRetry } from "@/google/client";
import { prisma } from "@/lib/db";

export function spaceUrl(spaceName: string) {
  return `https://chat.google.com/room/${spaceName.replace(/^spaces\//, "")}`;
}

export async function createSpace(displayName: string, memberEmails: string[], requestId: string) {
  if (isMock()) {
    const name = `spaces/${mockId("space", requestId)}`;
    return { name, url: spaceUrl(name) };
  }
  const res = await withRetry(() =>
    chat().spaces.setup({
      requestBody: {
        requestId,
        space: { spaceType: "SPACE", displayName: displayName.slice(0, 128) },
        memberships: memberEmails.map((email) => ({ member: { name: `users/${email}`, type: "HUMAN" } })),
      },
    }),
  );
  const name = res.data.name!;
  return { name, url: spaceUrl(name) };
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
      if ((e as { code?: number }).code !== 409) throw e;
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
