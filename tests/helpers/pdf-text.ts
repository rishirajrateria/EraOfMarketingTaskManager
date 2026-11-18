import pdfParse from "pdf-parse/lib/pdf-parse.js";

/** Extracts the text of a PDF buffer (whitespace-normalised) for layout assertions. */
export async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const r = await pdfParse(buf);
  return { text: r.text.replace(/\s+/g, " ").trim(), pages: r.numpages };
}
