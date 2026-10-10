/**
 * PDF file names for sales documents (ADR 0013). One pure helper so Drive uploads (client folder, Finance backend,
 * monthly folders), email / WhatsApp attachments, download headers and any ZIP entry all agree:
 *
 * - Tax invoice        → `Invoice No. EOM-25-26-0001 (Acme Pvt Ltd).pdf`
 * - Export invoice     → `Ex Invoice No. EOM-25-26-0002 (Globex LLC).pdf`
 * - Proforma           → `P Invoice (Acme Pvt Ltd).pdf` (no number: a proforma is not a record)
 * - Cancelled invoice  → `C Invoice No. EOM-25-26-0001 (Acme Pvt Ltd).pdf`
 * - Not yet approved   → `Draft Invoice (Acme Pvt Ltd).pdf` (preview only; never filed)
 * - Credit note        → unchanged: the number with unsafe characters replaced (`EOM-CN_25-26_0001.pdf`)
 *
 * The client's business (legal) name is used when set, else the client name. Characters illegal in file names
 * (/ \ : * ? " < > | and control characters) are replaced; spaces and the "(…)" format are kept. Client-safe.
 */
export type FileNameDoc = {
  number: string;
  docType: "TAX_INVOICE" | "EXPORT_INVOICE" | "PROFORMA" | "CREDIT_NOTE";
  taxMode?: string | null;
  status?: string | null;
  client: { name: string; businessName?: string | null };
};

const ILLEGAL = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_CLIENT = 80;

/** Replace characters Windows / macOS / Drive reject; collapse whitespace; no leading/trailing dots or spaces. */
export function sanitizeFileNamePart(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/[/\\]/g, "-")
    .replace(ILLEGAL, "")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
}

export function clientDisplayName(client: FileNameDoc["client"]): string {
  const raw = client.businessName?.trim() || client.name;
  const clean = sanitizeFileNamePart(raw).slice(0, MAX_CLIENT).trim();
  return clean || "Client";
}

const isDraft = (n: string) => n.startsWith("DRAFT-");
const isExport = (d: FileNameDoc) => d.docType === "EXPORT_INVOICE" || d.taxMode === "EXPORT_LUT";

/** Legacy style kept for credit notes (and any unknown type): `EOM-CN/25-26/0001` → `EOM-CN_25-26_0001.pdf`. */
export const legacyPdfName = (number: string) => `${number.replace(/[^\w.-]+/g, "_")}.pdf`;

/**
 * The PDF file name for an invoice-like document. `cancelled` forces the "C Invoice" name (used while the cancel
 * flow files the stamped copy, before the caller has re-read the row).
 */
export function invoiceFileName(doc: FileNameDoc, opts: { cancelled?: boolean } = {}): string {
  if (doc.docType === "CREDIT_NOTE") return legacyPdfName(doc.number);
  const who = clientDisplayName(doc.client);
  if (doc.docType === "PROFORMA") return `P Invoice (${who}).pdf`;
  if (isDraft(doc.number)) return `Draft Invoice (${who}).pdf`;
  const no = sanitizeFileNamePart(doc.number) || "-";
  if (opts.cancelled || doc.status === "CANCELLED") return `C Invoice No. ${no} (${who}).pdf`;
  if (isExport(doc)) return `Ex Invoice No. ${no} (${who}).pdf`;
  return `Invoice No. ${no} (${who}).pdf`;
}

/** ASCII-only fallback for old clients that ignore `filename*`. */
const asciiFallback = (name: string) => name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");

/**
 * RFC 6266 Content-Disposition with an ASCII `filename` and a UTF-8 `filename*`, so names with spaces,
 * parentheses or non-Latin client names survive every browser.
 */
export function contentDisposition(kind: "inline" | "attachment", name: string): string {
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${asciiFallback(name)}"; filename*=UTF-8''${encoded}`;
}
