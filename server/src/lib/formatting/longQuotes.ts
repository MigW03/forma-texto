import { getBlocks, isParagraph, isListItem, blockText, setParagraphStyle, replaceBlocks } from './blocks'
import { LONG_QUOTE_STYLE } from './guidelines'

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
 * Only whole, standalone quoted paragraphs are converted — a quotation embedded in the
 * middle of a larger paragraph would need the paragraph split around it (mid-run), which
 * is deliberately left for a later pass.
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
    if (!quoted && !indented) return

    let out = setParagraphStyle(b, LONG_QUOTE_STYLE)
    if (quoted) out = stripSurroundingQuotes(out)
    byIndex.set(i, out)
  })

  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}
