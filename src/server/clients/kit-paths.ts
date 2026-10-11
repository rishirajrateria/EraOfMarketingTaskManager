/**
 * Pure helpers for a client's kit (ADR 0014); safe on client and server, no I/O.
 * `clientWorkFolderId` is the hook for task folders: new task Drive folders should be created inside the client's
 * kit "Work" folder when the client has a kit (src/google/task-integrations.ts adopts it separately).
 */
export type KitIds = {
  kitFolderId?: string | null;
  kitBrandId?: string | null;
  kitCredentialsId?: string | null;
  kitSheetId?: string | null;
  kitWorkId?: string | null;
  kitReportsId?: string | null;
};

export const DEFAULT_KIT_FOLDERS = ["Brand kit", "Credentials", "Work", "Reports"] as const;

/** The client's kit "Work" folder id, or null when the client has no kit yet. */
export function clientWorkFolderId(client: KitIds): string | null {
  return client.kitFolderId && client.kitWorkId ? client.kitWorkId : null;
}

export const hasKit = (c: KitIds) => Boolean(c.kitFolderId && c.kitBrandId && c.kitCredentialsId && c.kitSheetId && c.kitWorkId && c.kitReportsId);

const folder = (id: string) => `https://drive.google.com/drive/folders/${id}`;

export function kitUrls(c: KitIds) {
  if (!c.kitFolderId) return null;
  const f = (id?: string | null) => (id ? folder(id) : null);
  return {
    folder: folder(c.kitFolderId),
    brand: f(c.kitBrandId),
    credentials: f(c.kitCredentialsId),
    sheet: c.kitSheetId ? `https://docs.google.com/spreadsheets/d/${c.kitSheetId}/edit` : null,
    work: f(c.kitWorkId),
    reports: f(c.kitReportsId),
  };
}

/** The four subfolder names from Settings, falling back to the defaults for blanks / a short list. */
export function kitFolderNames(saved: string[] | null | undefined): [string, string, string, string] {
  const s = saved ?? [];
  return [0, 1, 2, 3].map((i) => s[i]?.trim() || DEFAULT_KIT_FOLDERS[i]) as [string, string, string, string];
}

/** The message sent with the kit link (email = long, WhatsApp = short). */
export function kitMessage(opts: { channel: "EMAIL" | "WHATSAPP"; greetName: string; clientName: string; company: string; url: string; folders: [string, string, string, string] }): string {
  const [brand, creds, work, reports] = opts.folders;
  if (opts.channel === "WHATSAPP") {
    return [
      `Hi ${opts.greetName}, here is your ${opts.company} client kit: ${opts.url}`,
      `• ${brand}: upload your logo, fonts, colours and photos.`,
      `• ${creds}: fill the "${opts.clientName} — Credentials" sheet (see its "How to fill" tab).`,
      `• ${work}: our work for you appears here. ${reports}: your reports.`,
      "Reply here if anything is unclear.",
    ].join("\n");
  }
  return [
    `Hi ${opts.greetName},`,
    "",
    `Here is your ${opts.company} client kit — one Google Drive folder for everything we need from you:`,
    opts.url,
    "",
    `• ${brand} — upload your logo, fonts, brand colours and any photos or videos we should use.`,
    `• ${creds} — fill the "${opts.clientName} — Credentials" sheet, one row per platform. The "How to fill" tab explains each column. Please never put bank details, card numbers or UPI PINs in it.`,
    `• ${work} — this is where we will share the work we create for you.`,
    `• ${reports} — your reports will appear here.`,
    "",
    "Reply to this email if anything is unclear.",
    "",
    "Thanks,",
    opts.company,
  ].join("\n");
}
