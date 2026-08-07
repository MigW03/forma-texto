/**
 * Shared top-level block parser for the formatting passes (Step B, C, D).
 *
 * A "block" is a top-level child of `<w:body>` — a paragraph (`<w:p>`), table
 * (`<w:tbl>`) or structured-document-tag (`<w:sdt>`) — in document order. Every
 * block keeps its ABSOLUTE index (its position in the body, 0..N). That index is
 * the key that makes the AI passes' merge trivial: the model returns decisions
 * keyed by index, and `replaceBlocks` splices rewritten blocks back by index.
 *
 * Regex over WordprocessingML is fragile in general, but bounded here to top-level
 * block extraction and `<w:pStyle>` rewrites, which is safe — WITH ONE CONFIRMED
 * EXCEPTION: `<w:tbl>` and `<w:sdt>` can both legitimately nest (a table inside a
 * table cell; Google Docs export can nest structured-document-tags — a real document
 * hit this: `<w:sdt><w:sdtContent><w:ins/><w:sdt>...</w:sdt></w:sdtContent></w:sdt>`).
 * A single non-greedy regex (the previous implementation here) closes at the FIRST
 * matching close tag it finds — the INNER one — silently orphaning the outer tag's
 * remaining content outside of any recognized block. That's harmless for a pass that
 * only ever replaces a handful of SPECIFIC indices elsewhere in the document (the
 * orphaned text just passes through `replaceBlocks` untouched, since `.replace()` only
 * touches matched spans) — but a pass that reconstructs a whole region from the
 * `blocks[]` array (`applyCoverVerticalDistribution` in `preTextual.ts`) drops that
 * orphaned text from its output while the ORIGINAL string still contains its dangling
 * closing tags elsewhere — genuinely invalid XML that LibreOffice refused to even open
 * ("source file could not be loaded"), confirmed against the real document that
 * surfaced this. `findBlockSpans` below replaces the single regex with a proper
 * depth-tracked scan for `<w:tbl>`/`<w:sdt>` (paragraphs never nest, so the simple
 * non-greedy match stays correct for `<w:p>`).
 */

import { decodeXmlEntities } from './xmlText'

interface BlockSpan {
  start: number
  /** Exclusive. */
  end: number
}

/** The tag types that open a block; used to find where the NEXT one starts scanning from. */
const TOP_LEVEL_OPEN_RE = /<w:tbl\b[^>]*>|<w:sdt\b[^>]*>|<w:p\b[^>]*\/>|<w:p\b[^>]*>/g

/**
 * Index just past the true, OUTERMOST closing tag for a `<w:tbl>` or `<w:sdt>` whose
 * own opening tag starts at `openIdx`. Depth-tracked so a nested occurrence of the same
 * tag doesn't fool it into stopping early. Returns -1 if unterminated (malformed input —
 * callers stop rather than emit a corrupted block in that case).
 */
function findNestedBlockEnd(xml: string, openIdx: number, tag: 'tbl' | 'sdt'): number {
  const openRe = new RegExp(`<w:${tag}\\b[^>]*?/?>`, 'g')
  const closeTag = `</w:${tag}>`
  let depth = 0
  let i = openIdx
  for (;;) {
    openRe.lastIndex = i
    const openMatch = openRe.exec(xml)
    const closeIdx = xml.indexOf(closeTag, i)
    if (closeIdx === -1) return -1
    if (openMatch && openMatch.index < closeIdx) {
      if (!openMatch[0].endsWith('/>')) depth++ // a self-closed tag needs no matching close
      i = openMatch.index + openMatch[0].length
    } else {
      depth--
      i = closeIdx + closeTag.length
      if (depth === 0) return i
    }
  }
}

/** Every top-level block's `[start, end)` span, in document order. */
function findBlockSpans(xml: string): BlockSpan[] {
  const spans: BlockSpan[] = []
  let i = 0
  while (i < xml.length) {
    TOP_LEVEL_OPEN_RE.lastIndex = i
    const m = TOP_LEVEL_OPEN_RE.exec(xml)
    if (!m) break
    const start = m.index
    let end: number
    if (m[0].startsWith('<w:tbl')) end = findNestedBlockEnd(xml, start, 'tbl')
    else if (m[0].startsWith('<w:sdt')) end = findNestedBlockEnd(xml, start, 'sdt')
    else if (m[0].endsWith('/>')) end = start + m[0].length // self-closed <w:p/>
    else {
      const closeIdx = xml.indexOf('</w:p>', start)
      end = closeIdx === -1 ? -1 : closeIdx + '</w:p>'.length
    }
    if (end === -1) break // malformed from here on — stop rather than corrupt further
    spans.push({ start, end })
    i = end
  }
  return spans
}

/**
 * Apply `fn` to every top-level block in document order, splicing its return value back
 * in; content between blocks (whitespace, `<w:sectPr>`, anything `findBlockSpans` doesn't
 * recognize) passes through byte-for-byte, same as the old `documentXml.replace(BLOCK_RE, …)`
 * pattern this replaces. `getBlocks`/`replaceBlocks` are both built on this.
 */
export function mapBlocks(documentXml: string, fn: (block: string) => string): string {
  const spans = findBlockSpans(documentXml)
  let result = ''
  let cursor = 0
  for (const s of spans) {
    result += documentXml.slice(cursor, s.start)
    result += fn(documentXml.slice(s.start, s.end))
    cursor = s.end
  }
  result += documentXml.slice(cursor)
  return result
}

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

/**
 * True for a structured-document-tag block (`<w:sdt>`) — Word/Google-Docs-export wraps
 * odds and ends in these (tracked-suggestion remnants, content controls). Valid as a
 * child of `<w:tc>` too, so passes that move blocks into a table cell can treat it like
 * a paragraph for nesting purposes; it carries no `<w:t>` text via `blockText`, so it
 * reads as blank for any text-based scan (heading/caption/foot detection, etc.).
 */
export const isStructuredDocTag = (b: string) => /^<w:sdt\b/.test(b)

/** True when the paragraph belongs to a numbered/bulleted list (`<w:numPr>` in its pPr). */
export const isListItem = (b: string) => /<w:numPr\b/.test(b)

/**
 * Visible text of a block (all `<w:t>` runs concatenated, tags stripped, entities decoded,
 * trimmed). A tab character emits a space so Word auto-TOC page numbers don't merge into
 * the section name — `isTocEntry` in `preTextual.ts` keys on that separator.
 *
 * The `<w:t` match must be anchored on a word boundary: `<w:tabs>` (the tab-stop container,
 * present on nearly every right-tab-stopped paragraph) and the attributed `<w:tab w:val=…/>`
 * inside it BOTH start with the literal four characters `<w:t`. A looser `/<w:t[^>]*>/` opens
 * on those and greedily swallows everything up to the next real `</w:t>` as paragraph text —
 * confirmed leaking a Google Docs auto-TOC field code into the extracted text of a real
 * document. Runs are matched in document order alongside tabs (rather than collecting `<w:t>`
 * spans and separately replacing tabs) because a tab lives *between* runs, so a replacement
 * outside the captured spans is dropped before it can act as a separator.
 */
export const blockText = (b: string) => {
  const parts: string[] = []
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(b)) !== null) {
    parts.push(m[1] === undefined ? ' ' : m[1].replace(/<[^>]+>/g, ''))
  }
  return decodeXmlEntities(parts.join('').trim())
}

/** Top-level body blocks (paragraphs / tables / sdt), in document order. */
export function getBlocks(documentXml: string): string[] {
  return findBlockSpans(documentXml).map(s => documentXml.slice(s.start, s.end))
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
 * Appends at the END of the pPr children — fine for order-agnostic properties, but
 * NOT for ones the schema requires early (use `addKeepNext` for `<w:keepNext/>`).
 * Example: addPPrProperty(block, '<w:pageBreakBefore/>')
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
 * Add `<w:keepNext/>` (keep this paragraph on the same page as the next one) in a
 * schema-valid position. `CT_PPr` orders `keepNext` right after `pStyle` and BEFORE
 * `spacing`/`ind`/`jc` — appending it at the end of an existing pPr (which may already
 * carry `jc`, e.g. a centered image paragraph) is out-of-order and renderers drop it.
 * So insert it immediately after `<w:pStyle>` when present, else as the first pPr child.
 * Idempotent: a no-op when the paragraph already keeps with the next.
 *
 * NOTE the element is `w:keepNext`, not `w:keepWithNext` — the latter is not a
 * WordprocessingML element and is silently ignored (that was a real bug: figure
 * captions "kept" with an element that never existed, so they split across pages).
 */
export function addKeepNext(p: string): string {
  if (/<w:keepNext\b/.test(p)) return p
  if (/<w:pStyle\b[^>]*\/>/.test(p)) return p.replace(/(<w:pStyle\b[^>]*\/>)/, '$1<w:keepNext/>')
  if (/<w:pPr\b[^>]*>/.test(p)) return p.replace(/(<w:pPr\b[^>]*>)/, '$1<w:keepNext/>')
  if (/<w:pPr\b[^>]*\/>/.test(p)) return p.replace(/<w:pPr\b[^>]*\/>/, '<w:pPr><w:keepNext/></w:pPr>')
  return p.replace(/(<w:p\b[^>]*>)/, '$1<w:pPr><w:keepNext/></w:pPr>')
}

/**
 * Splice rewritten blocks back into the document by absolute index. Blocks not
 * present in `byIndex` are left byte-for-byte untouched. Index alignment holds
 * because the same `findBlockSpans` scan produced `getBlocks` and drives this replace.
 */
export function replaceBlocks(documentXml: string, byIndex: Map<number, string>): string {
  let i = 0
  return mapBlocks(documentXml, block => {
    const cur = i++
    return byIndex.has(cur) ? byIndex.get(cur)! : block
  })
}
