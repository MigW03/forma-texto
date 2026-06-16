/**
 * Run-level apply core for Step P (proofreading).
 *
 * Step P's model returns the CORRECTED plain text of a paragraph. Unlike Step C
 * (which re-renders a whole reference entry as fresh runs) or Step D (which only
 * swaps `<w:pStyle>`), proofreading must drop the corrected text back into a body
 * paragraph WITHOUT destroying the author's intentional run-level formatting —
 * a bold term, an italic word, a coloured span are all `<w:r>` runs with their own
 * `<w:rPr>`, and flattening the paragraph to one run would erase them.
 *
 * Strategy: parse the paragraph into runs, merge adjacent runs that share identical
 * `<w:rPr>` (Word splits runs at edit points even when the formatting is the same),
 * diff the original concatenated text against the corrected text, and map each edit
 * back onto the single run it falls inside — leaving every other run byte-for-byte.
 * An edit that would cross a real formatting boundary (or sits in a paragraph with
 * hyperlinks/fields/footnotes) is refused: the paragraph is left unchanged. Worst
 * case of a bad answer is therefore an UNCHANGED paragraph, never corrupted text —
 * the same conservative contract as Steps C and D.
 */
import { diff } from './textDiff'
import { escapeXml } from './xmlText'

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Elements that make a run unsafe to rewrite as plain text (would lose content). */
const NON_TEXT_RUN_RE = /<w:(br|tab|drawing|object|pict|fldChar|instrText|footnoteReference|endnoteReference|noBreakHyphen|sym)\b/

/** Paragraph-level constructs we never splice into — too easy to corrupt. */
const UNSAFE_PARAGRAPH_RE = /<w:hyperlink\b|<w:fldSimple\b|<w:fldChar\b|<w:instrText\b|<w:footnoteReference\b|<w:endnoteReference\b/

/** A run reduced to plain text plus its formatting; or an opaque chunk we preserve verbatim. */
type Item =
  | { kind: 'text'; rPr: string; text: string }
  | { kind: 'anchor'; raw: string }

interface ParsedParagraph {
  openTag: string
  pPr: string
  items: Item[]
  /** Concatenated text of all text items, in order — the diff base + what the model sees. */
  exact: string
}

/** True when the paragraph is safe to proofread-splice (no hyperlinks/fields/footnotes). */
export function canSpliceParagraph(p: string): boolean {
  if (/^<w:p\b[^>]*\/>/.test(p)) return false // self-closed <w:p/> — no runs
  if (!/^<w:p\b[^>]*>/.test(p)) return false
  return !UNSAFE_PARAGRAPH_RE.test(p)
}

const runIsPureText = (run: string) => /<w:t[\s>]/.test(run) && !NON_TEXT_RUN_RE.test(run)

const rPrOf = (run: string) => {
  const m = run.match(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>|<w:rPr\b[^>]*\/>/)
  return m ? m[0] : ''
}

const textOf = (run: string) =>
  (run.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
    .map(t => decodeXml(t.replace(/^<w:t\b[^>]*>/, '').replace(/<\/w:t>$/, '')))
    .join('')

/**
 * Parse a paragraph into ordered items, coalescing adjacent same-`rPr` text runs.
 * Returns null when the paragraph has no splice-able shape (self-closed / unsafe).
 */
function parseParagraph(p: string): ParsedParagraph | null {
  if (!canSpliceParagraph(p)) return null
  const open = p.match(/^<w:p\b[^>]*>/)
  if (!open) return null
  const openTag = open[0]
  const closeAt = p.lastIndexOf('</w:p>')
  if (closeAt < 0) return null

  let body = p.slice(openTag.length, closeAt)
  const pPrMatch = body.match(/^<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|^<w:pPr\b[^>]*\/>/)
  const pPr = pPrMatch ? pPrMatch[0] : ''
  if (pPr) body = body.slice(pPr.length)

  const raw: Item[] = []
  const re = /<w:r\b[^>]*>[\s\S]*?<\/w:r>|<w:r\b[^>]*\/>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    if (m.index > last) raw.push({ kind: 'anchor', raw: body.slice(last, m.index) })
    const run = m[0]
    if (runIsPureText(run)) raw.push({ kind: 'text', rPr: rPrOf(run), text: textOf(run) })
    else raw.push({ kind: 'anchor', raw: run })
    last = re.lastIndex
  }
  if (last < body.length) raw.push({ kind: 'anchor', raw: body.slice(last) })

  // Merge adjacent text items with identical rPr so spurious run splits don't look
  // like formatting boundaries. Anchors (and rPr changes) break the run.
  const items: Item[] = []
  for (const it of raw) {
    const prev = items[items.length - 1]
    if (it.kind === 'text' && prev && prev.kind === 'text' && prev.rPr === it.rPr) {
      prev.text += it.text
    } else {
      items.push(it.kind === 'text' ? { ...it } : it)
    }
  }

  const exact = items.map(it => (it.kind === 'text' ? it.text : '')).join('')
  return { openTag, pPr, items, exact }
}

/** Concatenated visible text of a paragraph, exactly as the diff/model will see it. */
export function paragraphText(p: string): string {
  const parsed = parseParagraph(p)
  return parsed ? parsed.exact : ''
}

interface Span {
  itemIndex: number
  start: number
  end: number
}

/** Text-offset span [start, end) within `exact` for each text item, in order. */
function textSpans(items: Item[]): Span[] {
  const spans: Span[] = []
  let offset = 0
  items.forEach((it, itemIndex) => {
    if (it.kind !== 'text') return
    spans.push({ itemIndex, start: offset, end: offset + it.text.length })
    offset += it.text.length
  })
  return spans
}

/** Find the single text span that fully contains a hunk, or null if it crosses runs. */
function coveringSpan(spans: Span[], aStart: number, aEnd: number): Span | null {
  if (aStart === aEnd) {
    // Insertion: prefer the span that ENDS at this offset (keep the left run's format),
    // else the span that contains it.
    const left = spans.find(s => s.end === aStart && s.start <= aStart)
    if (left) return left
    return spans.find(s => s.start <= aStart && aStart <= s.end) ?? null
  }
  return spans.find(s => s.start <= aStart && aEnd <= s.end) ?? null
}

/** Render the items back to run XML; empty text runs are dropped, anchors kept verbatim. */
function renderItems(items: Item[]): string {
  return items
    .map(it => {
      if (it.kind === 'anchor') return it.raw
      if (it.text.length === 0) return ''
      return `<w:r>${it.rPr}<w:t xml:space="preserve">${escapeXml(it.text)}</w:t></w:r>`
    })
    .join('')
}

/**
 * Apply `corrected` to paragraph `p`, preserving every run's formatting. Returns the
 * rewritten paragraph, or null to mean "leave it unchanged" — when the paragraph is
 * unsafe, the text is identical, or any edit crosses a run/formatting boundary.
 */
export function spliceCorrectedText(p: string, corrected: string): string | null {
  const parsed = parseParagraph(p)
  if (!parsed) return null
  if (corrected === parsed.exact) return null

  const hunks = diff(parsed.exact, corrected)
  if (hunks.length === 0) return null

  const spans = textSpans(parsed.items)
  if (spans.length === 0) return null

  // Each hunk must fall inside one text item; otherwise bail on the whole paragraph.
  type Edit = { span: Span; aStart: number; aEnd: number; replacement: string }
  const edits: Edit[] = []
  for (const h of hunks) {
    const span = coveringSpan(spans, h.aStart, h.aEnd)
    if (!span) return null
    edits.push({ span, aStart: h.aStart, aEnd: h.aEnd, replacement: h.replacement })
  }

  // Apply per item, right-to-left, so earlier offsets stay valid as text shifts.
  const items = parsed.items.map(it => (it.kind === 'text' ? { ...it } : it))
  const byItem = new Map<number, Edit[]>()
  for (const e of edits) {
    const arr = byItem.get(e.span.itemIndex) ?? []
    arr.push(e)
    byItem.set(e.span.itemIndex, arr)
  }
  for (const [itemIndex, itemEdits] of byItem) {
    const it = items[itemIndex]
    if (it.kind !== 'text') return null
    const span = (itemEdits[0] as Edit).span
    itemEdits.sort((a, b) => b.aStart - a.aStart)
    let text = it.text
    for (const e of itemEdits) {
      const local = e.aStart - span.start
      const localEnd = e.aEnd - span.start
      text = text.slice(0, local) + e.replacement + text.slice(localEnd)
    }
    it.text = text
  }

  return `${parsed.openTag}${parsed.pPr}${renderItems(items)}</w:p>`
}
