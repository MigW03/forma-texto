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

import { decodeXmlEntities } from './xmlText'

export const BLOCK_RE =
  /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:sdt\b[\s\S]*?<\/w:sdt>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g

/** Max chars of body text kept in a descriptor — heading cues live at the start. */
const TEXT_CAP = 200

/**
 * Chars beyond which a heading-styled paragraph is implausible as a real heading —
 * a real title/heading is a short line; anything longer is almost certainly a body
 * paragraph left in a heading style by mistake. Shared by `headingSanity.ts` (which
 * corrects the paragraph's style) and `sumario.ts` (which guards the TOC as a second,
 * independent line of defense).
 */
export const MAX_HEADING_CHARS = 200

export const isParagraph = (b: string) => /^<w:p\b/.test(b)

/** True when the paragraph belongs to a numbered/bulleted list (`<w:numPr>` in its pPr). */
export const isListItem = (b: string) => /<w:numPr\b/.test(b)

/** Visible text of a block (all `<w:t>` runs concatenated, tags stripped, entities decoded, trimmed). Tab elements emit a space so Word auto-TOC page numbers don't merge into the section name. */
export const blockText = (b: string) => {
  const withTabs = b.replace(/<w:tab\/>/g, ' ')
  const raw = (withTabs.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('').trim()
  return decodeXmlEntities(raw)
}

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
  /** True when the paragraph is a list item — never a heading, regardless of other cues. */
  listItem: boolean
  /** True when this is the first non-empty paragraph on its page — a soft h1 cue. Set by the chunker (needs whole-doc pagination), not by `blockDescriptor`. */
  atPageStart?: boolean
}

/** Reduce a block to its descriptor at absolute index `i`. */
export function blockDescriptor(block: string, i: number): BlockDescriptor {
  const full = blockText(block)
  const styleMatch = block.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)
  // Treat <w:b/> and <w:b w:val="true|1|on"/> as bold; ignore explicit off values.
  const bold = /<w:b\/>|<w:b\b[^>]*w:val="(?:true|1|on)"/.test(block)
  return { i, text: full.slice(0, TEXT_CAP), style: styleMatch ? styleMatch[1] : 'Normal', bold, len: full.length, listItem: isListItem(block) }
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
 * Merge a `w:before` value into an existing `<w:spacing>` element in the pPr, or
 * inject a new one. Safe when the paragraph already has a `<w:spacing>` for line
 * height — avoids duplicate elements that cause the first one to silently win.
 */
export function setSpacingBefore(p: string, twips: number): string {
  const attr = ` w:before="${twips}" w:beforeAutospacing="0"`
  if (/<w:spacing\b/.test(p)) {
    // Strip any existing w:before / w:beforeAutospacing attrs, then inject ours.
    return p.replace(
      /<w:spacing\b([^/]*)\//,
      (_, rest) => {
        const cleaned = rest
          .replace(/\s*w:before="[^"]*"/g, '')
          .replace(/\s*w:beforeAutospacing="[^"]*"/g, '')
        return `<w:spacing${cleaned}${attr}/`
      },
    )
  }
  return addPPrProperty(p, `<w:spacing${attr}/>`)
}

/**
 * Inject a raw XML snippet into a paragraph's `<w:pPr>`, creating the element if
 * absent. Idempotent guard is the caller's responsibility (check before calling).
 * Example: addPPrProperty(block, '<w:keepWithNext/>')
 */
export function addPPrProperty(p: string, propXml: string): string {
  if (/<w:pPr\b[^>]*>/.test(p)) {
    return p.replace(/<\/w:pPr>/, `${propXml}</w:pPr>`)
  }
  if (/<w:pPr\b[^>]*\/>/.test(p)) {
    return p.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr>${propXml}</w:pPr>`)
  }
  return p.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${propXml}</w:pPr>`)
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
