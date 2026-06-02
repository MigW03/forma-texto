import { GUIDELINES, REFERENCES_HEADING_STYLE, type Guideline, type GuidelineSpec } from './guidelines'

/**
 * Step B (deterministic) — format the references section.
 *
 * Bounded to the pages the USER flagged as references (`references_pages`), NOT
 * to any occurrence of the word "Referências" (which can appear in body text).
 *
 * DOCX has no page numbers, so we map the flagged page numbers to paragraphs
 * using the SAME page-boundary detection the frontend slicer uses
 * (web/src/lib/docx-slice.ts): inline <w:sectPr> markers when present, otherwise
 * a 40-non-empty-blocks-per-page heuristic. Because the stored file is already
 * sliced to `selected_pages`, a reference page maps to its position within the
 * sorted selected pages → the corresponding virtual page of the stored document.
 *
 * Within the flagged region: the first non-empty paragraph is treated as the
 * section heading (→ REFERENCES_HEADING_STYLE); the rest get entry layout.
 */

const BLOCK_RE =
  /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:sdt\b[\s\S]*?<\/w:sdt>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
const BLOCKS_PER_PAGE = 40

const isParagraph = (b: string) => /^<w:p\b/.test(b)
const blockText = (b: string) =>
  (b.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('').trim()

/** Top-level body blocks (paragraphs / tables / sdt), in document order. */
function getBlocks(documentXml: string): string[] {
  return documentXml.match(BLOCK_RE) ?? []
}

/**
 * Block indices that START a new page, in order (always includes 0).
 *
 * Page boundaries in DOCX, by reliability:
 *  - manual page break `<w:br w:type="page"/>` — break-BEFORE if it precedes the
 *    paragraph's text (that paragraph opens the new page), else break-AFTER.
 *  - inline `<w:sectPr>` (section break) — break-AFTER (next paragraph is the new page).
 *  - `<w:lastRenderedPageBreak/>` — Word's render hint; treated as break-before.
 * Returns null when there is no explicit pagination (caller falls back to the
 * 40-block heuristic, mirroring docx-slice.ts).
 */
function pageStartIndices(blocks: string[]): number[] | null {
  const explicit = new Set<number>()
  const rendered = new Set<number>()
  let sawExplicit = false

  blocks.forEach((b, i) => {
    if (!isParagraph(b)) return
    const brPos = b.search(/<w:br\b[^>]*w:type="page"/)
    if (brPos >= 0) {
      sawExplicit = true
      const textPos = b.search(/<w:t[ >]/)
      if (textPos >= 0 && brPos < textPos) explicit.add(i) // leading break → this para starts a page
      else explicit.add(i + 1) // trailing/standalone break → next para starts a page
    }
    if (b.includes('<w:sectPr')) { sawExplicit = true; explicit.add(i + 1) } // break-after
    if (b.includes('<w:lastRenderedPageBreak')) rendered.add(i)
  })

  const starts = new Set<number>([0])
  if (sawExplicit) explicit.forEach(i => starts.add(i))
  else if (rendered.size) rendered.forEach(i => starts.add(i))
  else return null

  const arr = [...starts].filter(i => i >= 0 && i < blocks.length).sort((a, b) => a - b)
  return arr.length > 1 ? arr : null
}

/** Block indices per virtual page (0-based page position). */
function pageBlockIndices(blocks: string[]): number[][] {
  const starts = pageStartIndices(blocks)
  const pages: number[][] = []

  if (starts) {
    for (let k = 0; k < starts.length; k++) {
      const from = starts[k]
      const to = (k + 1 < starts.length ? starts[k + 1] : blocks.length) - 1
      const idxs: number[] = []
      for (let i = from; i <= to; i++) idxs.push(i)
      pages.push(idxs)
    }
  } else {
    // No explicit pagination → 40-non-empty-blocks-per-page heuristic.
    const nonEmpty: number[] = []
    blocks.forEach((b, i) => { if (blockText(b)) nonEmpty.push(i) })
    const total = Math.max(1, Math.ceil(nonEmpty.length / BLOCKS_PER_PAGE))
    for (let pg = 0; pg < total; pg++) {
      const slice = nonEmpty.slice(pg * BLOCKS_PER_PAGE, (pg + 1) * BLOCKS_PER_PAGE)
      if (slice.length === 0) { pages.push([]); continue }
      const idxs: number[] = []
      for (let i = slice[0]; i <= slice[slice.length - 1]; i++) idxs.push(i)
      pages.push(idxs)
    }
  }
  return pages
}

/** Set (or replace) the paragraph style id, creating <w:pPr>/<w:pStyle> if absent. */
function setParagraphStyle(p: string, styleId: string): string {
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

/** Inject entry layout props into a paragraph's pPr, in WordprocessingML schema order. */
function setEntryFormatting(p: string, g: GuidelineSpec): string {
  const r = g.references
  const ind = r.hangingIndent > 0
    ? `<w:ind w:left="${r.hangingIndent}" w:hanging="${r.hangingIndent}"/>`
    : '<w:ind w:left="0" w:firstLine="0"/>'
  const props =
    `<w:spacing w:after="${r.entryAfter}" w:line="${r.entryLine}" w:lineRule="auto"/>` +
    ind +
    `<w:jc w:val="${r.entryAlign}"/>`

  let q = p.replace(/<w:(spacing|ind|jc)\b[^>]*\/>/g, '')
  if (/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.test(q)) {
    return q.replace('</w:pPr>', props + '</w:pPr>')
  }
  if (/<w:pPr\b[^>]*\/>/.test(q)) {
    return q.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr>${props}</w:pPr>`)
  }
  return q.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${props}</w:pPr>`)
}

export interface ReferencePagesInput {
  selectedPages: number[]
  referencePages: number[]
}

export function formatReferences(
  documentXml: string,
  guideline: Guideline,
  { selectedPages, referencePages }: ReferencePagesInput,
): string {
  // No flagged pages (or no page metadata) → nothing to do.
  if (!referencePages?.length || !selectedPages?.length) return documentXml

  const g = GUIDELINES[guideline]
  const blocks = getBlocks(documentXml)
  if (!blocks.length) return documentXml

  const pages = pageBlockIndices(blocks)
  const sorted = [...selectedPages].sort((a, b) => a - b)

  // Each flagged (original) page → its position in the sliced doc → that virtual page's blocks.
  const refBlocks = new Set<number>()
  for (const original of referencePages) {
    const pos = sorted.indexOf(original)
    if (pos >= 0) (pages[pos] ?? []).forEach(i => refBlocks.add(i))
  }
  if (refBlocks.size === 0) return documentXml

  // First non-empty paragraph in the flagged region = the references heading.
  let headingIdx = -1
  for (const i of [...refBlocks].sort((a, b) => a - b)) {
    if (isParagraph(blocks[i]) && blockText(blocks[i])) { headingIdx = i; break }
  }

  let idx = 0
  return documentXml.replace(BLOCK_RE, (m) => {
    const i = idx++
    if (i === headingIdx) return setParagraphStyle(m, REFERENCES_HEADING_STYLE)
    if (refBlocks.has(i) && isParagraph(m) && blockText(m)) return setEntryFormatting(m, g)
    return m
  })
}
