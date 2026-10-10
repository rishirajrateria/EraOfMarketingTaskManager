import sanitizeHtml from "sanitize-html";

/** Strict allowlist for rich-text task descriptions (SPEC §6). Applied on write; the client also sanitises on render. */
export function sanitizeDescription(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["p", "br", "b", "strong", "i", "em", "u", "s", "ul", "ol", "li", "a", "blockquote", "h1", "h2", "h3"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: { a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }) },
  });
}

/** Attachment MIME types that may be rendered inline; everything else is served as a download. */
export const INLINE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "video/webm", "video/mp4", "application/pdf"]);

export function safeMime(mime: string | null | undefined): string {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  return INLINE_MIME.has(m) ? m : "application/octet-stream";
}
