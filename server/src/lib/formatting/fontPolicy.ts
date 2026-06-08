/**
 * Font policy for Step A — resolve the ONE font family the whole document should
 * use (body + headings + title + references all share it; the families are never
 * mixed within a document).
 *
 * Policy (mirrors the guideline spec's §3): if the source already uses an accepted
 * family, keep it — so a document the author wrote in Arial stays Arial, headings
 * included. Only when the source font is not an accepted family do we fall back to
 * the guideline default. The user explicitly choosing a font (a future picker)
 * would take precedence over both; that hook is the `chosen` argument.
 */

/** Every `w:ascii` font name referenced by run/style `<w:rFonts>`, in document order. */
function asciiFonts(xml: string): string[] {
  const out: string[] = []
  const re = /<w:rFonts\b[^>]*\bw:ascii="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(m[1])
  return out
}

/**
 * The single family to apply across the document.
 *  - `chosen` (if an accepted family) wins — an explicit user choice.
 *  - else the most-used accepted family found in the source wins (keep what the
 *    author used: Arial body → Arial throughout).
 *  - else `fallback` (the guideline default), which also replaces any non-accepted
 *    source font.
 */
export function resolveDocumentFont(
  documentXml: string,
  stylesXml: string | null,
  accepted: string[],
  fallback: string,
  chosen?: string | null,
): string {
  if (chosen && accepted.includes(chosen)) return chosen

  const counts = new Map<string, number>()
  for (const f of [...asciiFonts(documentXml), ...asciiFonts(stylesXml ?? '')]) {
    counts.set(f, (counts.get(f) ?? 0) + 1)
  }

  let best: string | null = null
  let bestN = 0
  for (const fam of accepted) {
    const n = counts.get(fam) ?? 0
    if (n > bestN) {
      best = fam
      bestN = n
    }
  }
  return best ?? fallback
}
