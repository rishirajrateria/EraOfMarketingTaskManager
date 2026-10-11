/** Public base URL for links sent outside the app (WhatsApp PDF media). */
export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || "").replace(/\/+$/, "");
}

/** Unauthenticated PDF link for an invoice's publicToken (ADR 0005 `GET /api/public/invoice/[token]`). */
export function publicInvoiceUrl(token: string | null | undefined): string | null {
  return token ? `${publicBaseUrl()}/api/public/invoice/${token}` : null;
}
