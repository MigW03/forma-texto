/**
 * Shared top-level block parser for the formatting passes (Step B, C, D).
 *
 * A "block" is a top-level child of `<w:body>` — a paragraph (`<w:p>`), table
 * (`<w:tbl>`) or structured-document-tag (`<w:sdt>`) — in document order. Every
 * block keeps its ABSOLUTE index (its position in the body, 0..N). That index is
 * the key that makes the AI passes' merge trivial: the model returns decisions
 * keyed by index, and `replaceBlocks` splices rewritten blocks back by index.
 *
 * Regex over WordprocessingML is fragile in general, but bounded here to
 * top-level block extraction and `<w:pStyle>` rewrites, which is safe. If nested
 * tables ever cause index drift on real documents, swap the internals for
 * `fast-xml-parser` behind this same contract — the passes won't change.
 */

export const BLOCK_RE =
  /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:sdt\b[\s\S]*?<\/w:sdt>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g

/** Max chars of body text kept in a descriptor — heading cues live at the start. */
const TEXT_CAP = 200

export const isParagraph = (b: string) => /^<w:p\b/.test(b)

/** Visible text of a block (all `<w:t>` runs concatenated, tags stripped, trimmed). */
export const blockText = (b: string) =>
  (b.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('').trim()

/** Top-level body blocks (paragraphs / tables / sdt), in document order. */
export function getBlocks(documentXml: string): string[] {
  return documentXml.match(BLOCK_RE) ?? []
}

/** The compact shape the AI sees — truncated text plus a few classification cues. */
export interface BlockDescriptor {
  i: number
  text: string
  style: string
  bold: boolean
  len: number
  /** True when this is the first non-empty paragraph on its page — a soft h1 cue. Set by the chunker (needs whole-doc pagination), not by `blockDescriptor`. */
  atPageStart?: boolean
}

/** Reduce a block to its descriptor at absolute index `i`. */
export function blockDescriptor(block: string, i: number): BlockDescriptor {
  const full = blockText(block)
  const styleMatch = block.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)
  // Treat <w:b/> and <w:b w:val="true|1|on"/> as bold; ignore explicit off values.
  const bold = /<w:b\/>|<w:b\b[^>]*w:val="(?:true|1|on)"/.test(block)
  return { i, text: full.slice(0, TEXT_CAP), style: styleMatch ? styleMatch[1] : 'Normal', bold, len: full.length }
}

/** Set (or replace) a paragraph's style id, creating `<w:pPr>`/`<w:pStyle>` if absent. */
export function setParagraphStyle(p: string, styleId: string): string {
  if (/<w:pStyle\b[^>]*\/>/.test(p)) {
    return p.replace(/<w:pStyle\b[^>]*\/>/, `<w:pStyle w:val="${styleId}"/>`)
  }
  if (/<w:pPr\b[^>]*>/.test(p)) {
    return p.replace(/(<w:pPr\b[^>]*>)/, `$1<w:pStyle w:val="${styleId}"/>`)
  }
  if (/<w:pPr\b[^>]*\/>/.test(p)) {
    return p.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`)
  }
  return p.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`)
}

/** Remove a paragraph's `<w:pStyle>` so it falls back to the default style (demote to body). */
export function clearHeadingStyle(p: string): string {
  return p.replace(/<w:pStyle\b[^>]*\/>/, '')
}

/**
 * Splice rewritten blocks back into the document by absolute index. Blocks not
 * present in `byIndex` are left byte-for-byte untouched. Index alignment holds
 * because the same `BLOCK_RE` produced `getBlocks` and drives this replace.
 */
export function replaceBlocks(documentXml: string, byIndex: Map<number, string>): string {
  let i = 0
  return documentXml.replace(BLOCK_RE, m => {
    const cur = i++
    return byIndex.has(cur) ? byIndex.get(cur)! : m
  })
}
