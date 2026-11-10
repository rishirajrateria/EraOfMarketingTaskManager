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
  /** "Final work": the folder approved deliverables go in; the only folder (with Brand kit, Reports and the Credentials sheet) the client can open (ADR 0020). */
  kitFinalId?: string | null;
};

export const DEFAULT_KIT_FOLDERS = ["Brand kit", "Credentials", "Work", "Reports"] as const;
/** Name of the client-facing delivery folder (ADR 0020); Settings may override it as a 5th entry of the folder names. */
export const DEFAULT_FINAL_FOLDER = "Final work";
export const kitFinalName = (saved: string[] | null | undefined): string => saved?.[4]?.trim() || DEFAULT_FINAL_FOLDER;

/** The client's kit "Work" folder id, or null when the client has no kit yet. */
export function clientWorkFolderId(client: KitIds): string | null {
  return client.kitFolderId && client.kitWorkId ? client.kitWorkId : null;
}

export const hasKit = (c: KitIds) => Boolean(c.kitFolderId && c.kitBrandId && c.kitCredentialsId && c.kitSheetId && c.kitWorkId && c.kitReportsId && c.kitFinalId);

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
    final: f(c.kitFinalId),
  };
}

/** The four subfolder names from Settings, falling back to the defaults for blanks / a short list. */
export function kitFolderNames(saved: string[] | null | undefined): [string, string, string, string] {
  const s = saved ?? [];
  return [0, 1, 2, 3].map((i) => s[i]?.trim() || DEFAULT_KIT_FOLDERS[i]) as [string, string, string, string];
}

export type KitLinks = { brand: string | null; sheet: string | null; final: string | null; reports: string | null };

/**
 * The message sent with the kit links (email = long, WhatsApp = short). The client can open only Brand kit, the
 * Credentials sheet, Reports and Final work (ADR 0020), so each gets its own link; the kit root and Work are never mentioned.
 */
export function kitMessage(opts: { channel: "EMAIL" | "WHATSAPP"; greetName: string; clientName: string; company: string; links: KitLinks; folders: [string, string, string, string]; finalName?: string }): string {
  const [brand, creds, , reports] = opts.folders;
  const final = opts.finalName ?? DEFAULT_FINAL_FOLDER;
  const { links } = opts;
  const line = (label: string, url: string | null, text: string) => (url ? `• ${label}: ${text}\n  ${url}` : `• ${label}: ${text}`);
  if (opts.channel === "WHATSAPP") {
    return [
      `Hi ${opts.greetName}, here are your ${opts.company} client links:`,
      line(brand, links.brand, "upload your logo, fonts, colours and photos."),
      line(creds, links.sheet, `fill the "${opts.clientName} — Credentials" sheet (see its "How to fill" tab).`),
      line(final, links.final, "the finished work we share with you."),
      line(reports, links.reports, "your reports."),
      "Reply here if anything is unclear.",
    ].join("\n");
  }
  return [
    `Hi ${opts.greetName},`,
    "",
    `Here are the Google Drive links we share with you at ${opts.company}:`,
    "",
    line(brand, links.brand, "upload your logo, fonts, brand colours and any photos or videos we should use."),
    line(creds, links.sheet, `fill the "${opts.clientName} — Credentials" sheet, one row per platform. The "How to fill" tab explains each column. Please never put bank details, card numbers or UPI PINs in it.`),
    line(final, links.final, "the finished work we create for you will be placed here."),
    line(reports, links.reports, "your reports will appear here."),
    "",
    "Reply to this email if anything is unclear.",
    "",
    "Thanks,",
    opts.company,
  ].join("\n");
}

/** The links a client may see, from a kit's urls. */
export const clientLinks = (u: NonNullable<ReturnType<typeof kitUrls>>): KitLinks => ({ brand: u.brand, sheet: u.sheet, final: u.final, reports: u.reports });
