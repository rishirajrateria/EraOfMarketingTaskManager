import QRCode from "qrcode";

/** UPI deep link: `upi://pay?pa=<upiId>&pn=<payee>&am=<amount>&tn=<note>&cu=INR` (ADR 0005). */
export function upiPayUrl(opts: { upiId: string; payeeName: string; amount?: number | null; note?: string | null }): string {
  const q = new URLSearchParams();
  q.set("pa", opts.upiId.trim());
  q.set("pn", opts.payeeName.trim().slice(0, 50));
  if (opts.amount && opts.amount > 0) q.set("am", opts.amount.toFixed(2));
  if (opts.note) q.set("tn", opts.note.slice(0, 50));
  q.set("cu", "INR");
  return `upi://pay?${q.toString()}`;
}

/** PNG buffer of the UPI QR for the invoice PDF ("Scan to pay"). */
export async function upiQrPng(opts: { upiId: string; payeeName: string; amount?: number | null; note?: string | null }): Promise<Buffer> {
  return QRCode.toBuffer(upiPayUrl(opts), { type: "png", width: 160, margin: 1 });
}
