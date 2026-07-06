/**
 * Decode the `X-Filename` response header from `/api/documents/fetch`.
 *
 * The server percent-encodes the filename because HTTP header values are latin-1 —
 * a raw accented name (Título, Educação…) would be mangled or truncated in transit.
 * Falls back gracefully if the header is missing or (from an older server) not encoded.
 */
export function decodeFilename(header: string | null, fallback = 'document.docx'): string {
  if (!header) return fallback
  try {
    return decodeURIComponent(header)
  } catch {
    // Not percent-encoded (older server) — use as-is.
    return header
  }
}
