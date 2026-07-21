import { getBlocks, isParagraph, isListItem, blockText, setParagraphStyle, replaceBlocks } from './blocks'
import { LONG_QUOTE_STYLE } from './guidelines'
import { parseParagraph, type Item } from './runs'
import { escapeXml } from './xmlText'

/**
 * Long (block) quotation pass (ABNT NBR 10520): a direct quotation longer than three
 * lines is set apart as its own block — indented from the left, one font size smaller,
 * single line spacing, and WITHOUT quotation marks. This pass tags such paragraphs with
 * the `LongQuote` paragraph style (which `rewriteStyles` defines with the guideline's
 * block-quote geometry); the style, not this pass, carries the size/indent/spacing.
 *
 * MUST run BEFORE Step A's `stripDirectOverrides`, because one of the two detection
 * signals is the author's own left indent — and Step A strips every paragraph's direct
 * `<w:ind>` so the named styles can cascade. Tagging first means the block survives the
 * strip as a `LongQuote`-styled paragraph.
 *
 * Two deterministic signals, either is enough (both require the paragraph to be long —
 * a short quote stays inline per the norm):
 *  1. **Author already blocked it** — a left indent well beyond the body (which is flush
 *     left), i.e. the author manually recuo-ed the quote.
 *  2. **Over-long inline quotation** — the paragraph is wholly a quoted passage (opens
 *     with a quotation mark, closes with one, optionally trailed by an author-date
 *     citation) that runs past three lines. These get their surrounding quotation marks
 *     stripped, since the block layout replaces the marks (NBR 10520).
 *
 * A quotation embedded mid-paragraph (lead-in prose, then the quote, optionally more
 * prose after) is also handled: the paragraph is split into up to three — lead-in,
 * the quote (LongQuote-styled, marks stripped), and trailing text — via
 * `splitEmbeddedLongQuote`, reusing `runs.ts`'s paragraph parser so each piece keeps
 * its original run-level formatting (bold/italic spans). Conservative by the same
 * contract as the rest of this pipeline: any paragraph shape that isn't a plain run
 * of text (hyperlinks, fields, footnotes, tabs, drawings — anything `parseParagraph`
 * can't safely splice) is left unchanged rather than risk corrupting it.
 */

/**
 * Minimum visible-character count for "more than three lines". ABNT body text is ~90
 * chars per line at 12pt across a 16cm text area, so >3 lines is roughly >270 chars; we
 * use 280 to stay just clear of a borderline three-line quote.
 */
const MIN_LONG_QUOTE_CHARS = 280

/**
 * Left-indent (twips) at/above which a paragraph reads as an author-set block quote.
 * The body is flush left (0) with only a first-line indent (709), so ~1.75cm clears
 * any ordinary paragraph while catching the common 2.5–4cm quote recuo.
 */
const LEFT_INDENT_THRESHOLD = 1000

/** Opening / closing quotation marks (double, straight, and guillemets). */
const OPEN_QUOTE = /["“„«‹]/
const CLOSE_QUOTE = /["”»›]/
/** A closing quote near the paragraph end, optionally trailed by a citation and/or period. */
const CLOSE_AT_END = /["”»›]\s*(?:\([^)]*\))?\s*\.?\s*$/

/** Paragraph carries a heading/title style (author's or ours) — never a quote. */
const HEADING_STYLE = /<w:pStyle\b[^>]*w:val="(?:Title|[^"]*[Hh]eading[^"]*)"/

/** Read the paragraph's own left indent (twips) from its `<w:pPr>`, else 0. */
function leftIndentOf(block: string): number {
  const pPr = block.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/)?.[0] ?? ''
  const m = pPr.match(/<w:ind\b[^>]*\bw:(?:left|start)="(-?\d+)"/)
  return m ? parseInt(m[1], 10) : 0
}

/** True when the whole paragraph is a quotation: opens with a quote, closes with one. */
function isWhollyQuoted(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && OPEN_QUOTE.test(t[0]) && CLOSE_AT_END.test(t)
}

/** Last index of a closing-quote char in a string, or -1. */
function lastCloseQuoteIndex(s: string): number {
  for (let i = s.length - 1; i >= 0; i--) if (CLOSE_QUOTE.test(s[i])) return i
  return -1
}

/**
 * Remove the surrounding quotation marks from a wholly-quoted paragraph: the leading
 * open quote (first visible char of the first non-empty text run) and the trailing close
 * quote (last close-quote char in the last run that has one). Operates only inside
 * `<w:t>` text so it never touches attribute quotes in the XML tags.
 */
function stripSurroundingQuotes(p: string): string {
  const T = /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/g

  // Leading open quote: first non-empty text run.
  let openDone = false
  let out = p.replace(T, (m, open: string, txt: string, close: string) => {
    if (openDone) return m
    const i = txt.search(/\S/)
    if (i < 0) return m // empty run — keep scanning
    openDone = true
    return OPEN_QUOTE.test(txt[i]) ? `${open}${txt.slice(0, i)}${txt.slice(i + 1)}${close}` : m
  })

  // Trailing close quote: last text run that contains one.
  const runs = [...out.matchAll(T)]
  for (let k = runs.length - 1; k >= 0; k--) {
    const [full, open, txt, close] = runs[k]
    const idx = lastCloseQuoteIndex(txt)
    if (idx < 0) continue
    const replaced = `${open}${txt.slice(0, idx)}${txt.slice(idx + 1)}${close}`
    const at = runs[k].index!
    out = out.slice(0, at) + replaced + out.slice(at + full.length)
    break
  }

  return out
}

interface TextItem { rPr: string; text: string; start: number; end: number }

/**
 * Find an embedded quotation worth pulling out: an opening quote mark preceded by
 * real lead-in text (not at the very start — a paragraph opening with a quote is the
 * standalone case, already handled above), paired with the LAST closing-quote mark in
 * the paragraph (mirrors `stripSurroundingQuotes`'s own "outermost close" heuristic —
 * a long quotation commonly contains a nested quote-within-a-quote). Qualifies only
 * when the quoted span itself clears the length bar; a short embedded quote stays inline.
 */
function findEmbeddedQuoteSpan(flattened: string): { openIdx: number; closeIdx: number } | null {
  let openIdx = -1
  for (let i = 0; i < flattened.length; i++) {
    if (OPEN_QUOTE.test(flattened[i])) { openIdx = i; break }
  }
  if (openIdx <= 0 || !flattened.slice(0, openIdx).trim()) return null

  const closeIdx = lastCloseQuoteIndex(flattened)
  if (closeIdx < 0 || closeIdx <= openIdx + 1) return null
  if (closeIdx - openIdx - 1 < MIN_LONG_QUOTE_CHARS) return null

  return { openIdx, closeIdx }
}

/** Render the text items overlapping `[from, to)` as fresh `<w:r>` runs, formatting preserved. */
function sliceItemsXml(items: TextItem[], from: number, to: number): string {
  let out = ''
  for (const it of items) {
    const s = Math.max(from, it.start)
    const e = Math.min(to, it.end)
    if (s >= e) continue
    const piece = it.text.slice(s - it.start, e - it.start)
    if (!piece) continue
    out += `<w:r>${it.rPr}<w:t xml:space="preserve">${escapeXml(piece)}</w:t></w:r>`
  }
  return out
}

/**
 * Split a paragraph containing an embedded long quotation into lead-in / quote /
 * trailing paragraphs (the last omitted when there's no text after the quote). Returns
 * null when there's no qualifying embedded quote, or the paragraph's shape isn't a
 * plain run of text `parseParagraph` can safely re-splice (hyperlinks, fields,
 * footnotes, tabs, drawings, …) — same conservative contract as `runs.ts`.
 */
function splitEmbeddedLongQuote(p: string): string | null {
  const parsed = parseParagraph(p)
  if (!parsed || parsed.items.some((it: Item) => it.kind !== 'text')) return null

  let pos = 0
  const items: TextItem[] = parsed.items.map((it: Item) => {
    const { rPr, text } = it as Extract<Item, { kind: 'text' }>
    const start = pos
    pos += text.length
    return { rPr, text, start, end: pos }
  })
  const flattened = items.map(it => it.text).join('')

  const span = findEmbeddedQuoteSpan(flattened)
  if (!span) return null
  const { openIdx, closeIdx } = span

  const leadRuns = sliceItemsXml(items, 0, openIdx)
  const quoteRuns = sliceItemsXml(items, openIdx + 1, closeIdx)
  const trailRuns = sliceItemsXml(items, closeIdx + 1, flattened.length)
  if (!leadRuns || !quoteRuns) return null

  const leadP = `${parsed.openTag}${parsed.pPr}${leadRuns}</w:p>`
  const quoteP = setParagraphStyle(`${parsed.openTag}${parsed.pPr}${quoteRuns}</w:p>`, LONG_QUOTE_STYLE)
  const trailP = trailRuns ? `${parsed.openTag}${parsed.pPr}${trailRuns}</w:p>` : ''

  return leadP + quoteP + trailP
}

/**
 * Tag long (block) quotations with the `LongQuote` style and drop the quotation marks of
 * over-long inline quotes. `stopAt` freezes the appendix/annex (a reproduced document is
 * not re-blocked). Returns the document unchanged when nothing qualifies.
 */
export function formatLongQuotes(documentXml: string, stopAt = Infinity): string {
  const blocks = getBlocks(documentXml)
  if (!blocks.length) return documentXml

  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    if (i >= stopAt) return
    if (!isParagraph(b) || isListItem(b) || HEADING_STYLE.test(b)) return

    const text = blockText(b)
    if (text.length < MIN_LONG_QUOTE_CHARS) return // short quotes stay inline

    const quoted = isWhollyQuoted(text)
    const indented = leftIndentOf(b) >= LEFT_INDENT_THRESHOLD
    if (quoted || indented) {
      let out = setParagraphStyle(b, LONG_QUOTE_STYLE)
      if (quoted) out = stripSurroundingQuotes(out)
      byIndex.set(i, out)
      return
    }

    // Not a standalone block quote — check for a long quotation embedded mid-paragraph.
    const split = splitEmbeddedLongQuote(b)
    if (split) byIndex.set(i, split)
  })

  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}
