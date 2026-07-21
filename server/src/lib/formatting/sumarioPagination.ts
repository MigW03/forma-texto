import { getBlocks, blockText, replaceBlocks } from './blocks'
import { decodeXmlEntities } from './xmlText'
import { detectPretextual } from './preTextual'

/**
 * Sumário pagination — fills the page-number column of the TOC entries that
 * `buildSumario` created, using per-page text extracted from a REAL render of the
 * final document (LibreOffice → PDF, see `lib/paginateSumario.ts`). Also resolves
 * the placeholder `<w:pgNumType w:start="1"/>` `applyAbntPageNumbering` (in
 * `pageNumbering.ts`) stamps onto the body section, using the same render.
 *
 * This module is pure (XML + strings in, XML out) so it is unit-testable without
 * LibreOffice; the render/IO wrapper lives outside `formatting/`.
 *
 * Numbers shown to the reader — both the sumário's own entries and the header's
 * printed page number — are the PHYSICAL 1-based PDF page number MINUS `offset`
 * (1 when a capa is present, since NBR 14724 excludes it from the count; 0
 * otherwise, since the folha de rosto legitimately IS page 1). The two must always
 * shift by the same offset or they contradict each other — see
 * `paginateSumario.ts` for where both are computed from one render pass.
 */

export interface SumarioEntryRef {
  /** Absolute block index of the entry paragraph. */
  index: number
  /** Visible entry text (the heading title). */
  text: string
}

/** Signature of a `buildTocEntry` paragraph: right tab stop + suppressed hyphenation. */
const ENTRY_SIGNATURE_RE = /<w:tabs><w:tab w:val="right"[^>]*\/><\/w:tabs><w:suppressAutoHyphens\/>/

/**
 * The sumário's TOC entry paragraphs: the consecutive run of `buildTocEntry`-shaped
 * paragraphs right after the SUMÁRIO label. Anchored at the label (never a whole-doc
 * scan) and NOT trusting the detected section's `blockEnd` — after `buildSumario`,
 * `classifyPretextual`'s `bodyStart` can land on a TOC entry itself (an entry text like
 * "1 INTRODUÇÃO" without a page number passes `isBodyHeading`), which truncates the
 * section span. The structural signature is ours and unambiguous.
 */
export function findSumarioEntries(documentXml: string): SumarioEntryRef[] {
  const sumario = detectPretextual(documentXml).sections.find(s => s.kind === 'sumario')
  if (!sumario) return []
  const blocks = getBlocks(documentXml)
  const out: SumarioEntryRef[] = []
  for (let i = sumario.blockStart + 1; i < blocks.length; i++) {
    if (!ENTRY_SIGNATURE_RE.test(blocks[i])) break
    // The title is exactly the FIRST run's text (`buildTocEntry`: title run, tab run,
    // then optionally a previously stamped number run — which must not leak into the
    // match text, and a title legitimately ending in digits must stay intact).
    // `(?:\s|>)` keeps `<w:t>` / `<w:t attrs>` from also matching `<w:tabs>`.
    const m = blocks[i].match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/)
    const text = m ? decodeXmlEntities(m[1]).trim() : ''
    if (text) out.push({ index: i, text })
  }
  return out
}

/**
 * The block index where the textual part truly begins, for the ABNT section split.
 *
 * `detectPretextual`'s `bodyStart` can't be trusted for this once the sumário has been
 * rebuilt: its TOC entries read like body headings (a numbered entry "1 INTRODUÇÃO"
 * passes `isBodyHeading`, an unnumbered "Introdução" can pass the Introdução check), so
 * a fresh detection may land `bodyStart` on the FIRST TOC entry — which would drop the
 * page-numbering section break between the SUMÁRIO label and its own entries, stranding
 * the title on its own page. This anchors past the sumário's structurally-identified
 * entry run (`findSumarioEntries`, which keys on our unambiguous `buildTocEntry`
 * signature, not on text that can look like a heading), taking whichever is later so a
 * correctly-detected body start further down still wins. Falls back to `detectedBodyStart`
 * when there is no sumário.
 */
export function bodyStartForPageNumbering(documentXml: string, detectedBodyStart: number): number {
  const entries = findSumarioEntries(documentXml)
  if (entries.length === 0) return detectedBodyStart
  return Math.max(detectedBodyStart, entries[entries.length - 1].index + 1)
}

/** Uppercase, strip diacritics, collapse whitespace — tolerant text matching. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** How many pages the sumário itself spans, so its own entry texts are never matched. */
const MAX_TOC_PAGES = 6

/**
 * A page that IS the sumário (or its continuation): most of its text is our entry
 * titles. A body page containing a heading has prose around it, so its coverage
 * ratio stays low even when 2–3 entry texts appear on it.
 */
function looksLikeTocPage(pageNorm: string, entryNorms: string[]): boolean {
  if (!pageNorm) return false
  const found = entryNorms.filter(e => pageNorm.includes(e))
  if (found.length < Math.min(2, entryNorms.length)) return false
  const covered = [...new Set(found)].reduce((sum, e) => sum + e.length, 0)
  return covered / pageNorm.length >= 0.35
}

/**
 * Map each sumário entry text to the physical PDF page it appears on.
 *
 * The trap: the sumário page(s) contain every entry text, so a naive first-match finds
 * the TOC itself. The scan therefore (1) locates the SUMÁRIO label page, (2) skips the
 * contiguous run of TOC-looking pages from there, and (3) searches each entry from the
 * first body page onward, monotonically (entry k starts at entry k−1's page — headings
 * appear in document order, and repeated titles resolve to their own occurrence).
 * An entry that is never found gets `null` (its number stays blank — never a guess).
 */
export function assignEntryPages(entryTexts: string[], pageTexts: string[]): (number | null)[] {
  const entryNorms = entryTexts.map(normalize)
  const pageNorms = pageTexts.map(normalize)

  let labelPage = pageNorms.findIndex(p => p.includes('SUMARIO'))
  if (labelPage < 0) labelPage = 0
  let firstBody = labelPage + 1
  while (
    firstBody < pageNorms.length &&
    firstBody - labelPage < MAX_TOC_PAGES &&
    looksLikeTocPage(pageNorms[firstBody], entryNorms)
  ) {
    firstBody++
  }

  const result: (number | null)[] = []
  let cursor = firstBody
  // Two DIFFERENT headings may legitimately share a page (h1 + its first h2), so the
  // cursor stays on the found page — but a REPEATED title must advance past its own
  // previous occurrence, or every duplicate resolves to the first one's page.
  const lastPageIdxForText = new Map<string, number>()
  for (const e of entryNorms) {
    const prevIdx = lastPageIdxForText.get(e)
    const from = Math.max(cursor, prevIdx !== undefined ? prevIdx + 1 : 0)
    let found: number | null = null
    for (let p = from; p < pageNorms.length; p++) {
      if (pageNorms[p].includes(e)) {
        found = p + 1 // 1-based physical page
        cursor = p
        lastPageIdxForText.set(e, p)
        break
      }
    }
    result.push(found)
  }
  return result
}

/**
 * Replace (or append) the page-number run after an entry's tab run. Idempotent:
 * a re-run overwrites a previously stamped number instead of stacking a second one.
 *
 * The tab run is NOT necessarily the bare `<w:r><w:tab/></w:r>` `buildTocEntry`
 * emits: the explicit-font pass runs after `buildSumario` and stamps an
 * `<w:rPr><w:rFonts .../></w:rPr>` onto every run, the tab run included — so by the
 * time this pass runs the tab run reads `<w:r><w:rPr>…</w:rPr><w:tab/></w:r>`. The
 * regex therefore allows an optional `rPr` inside the tab run (a hard-coded
 * `<w:r><w:tab/></w:r>` silently matched nothing → 0 numbers stamped → every sumário
 * entry wrapped in the docx-preview). The stamped number run reuses the tab run's own
 * `rPr` so the digit inherits the same font as the entry.
 */
function setEntryPageNumber(entry: string, n: number): string {
  // The optional rPr uses a `(?!</w:r>)` guard so its lazy body can't span across a
  // run boundary — without it the leading `<w:r>` binds to the *title* run and the
  // rPr stretches to the tab run's own rPr, swallowing (and duplicating) the title.
  const rPr = '(<w:rPr>(?:(?!<\\/w:r>)[\\s\\S])*?<\\/w:rPr>)?'
  const re = new RegExp(`(<w:r>${rPr}<w:tab\\/><\\/w:r>)(<w:r>${rPr}<w:t[^>]*>\\d+<\\/w:t><\\/w:r>)?(<\\/w:p>)$`)
  return entry.replace(re, (_full, tabRun: string, tabRPr: string | undefined, _oldNum: string | undefined, _oldNumRPr: string | undefined, endP: string) =>
    `${tabRun}<w:r>${tabRPr ?? ''}<w:t>${n}</w:t></w:r>${endP}`)
}

export interface SumarioPaginationResult {
  documentXml: string
  /** Entries that received a page number. */
  assigned: number
  /** Total entries found in the sumário. */
  total: number
}

/**
 * Stamp real page numbers into the sumário entries, given the final document's
 * per-page text (from the PDF render) and the ABNT display offset (see module doc).
 * Entries whose heading text is not found on any body page, or that would resolve
 * to a display number below 1 (shouldn't happen — the offset only ever accounts for
 * the capa, which always precedes the sumário — but never guess), keep a blank
 * number. Block count never changes.
 */
export function applySumarioPageNumbers(documentXml: string, pageTexts: string[], offset = 0): SumarioPaginationResult {
  const entries = findSumarioEntries(documentXml)
  if (entries.length === 0) return { documentXml, assigned: 0, total: 0 }

  const pages = assignEntryPages(entries.map(e => e.text), pageTexts)
  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  entries.forEach((e, k) => {
    const physical = pages[k]
    if (physical === null) return
    const n = physical - offset
    if (n < 1) return
    const next = setEntryPageNumber(blocks[e.index], n)
    if (next !== blocks[e.index]) byIndex.set(e.index, next)
  })

  return {
    documentXml: byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml,
    assigned: byIndex.size,
    total: entries.length,
  }
}

/**
 * The physical 1-based PDF page where the body/textual part begins (the
 * "Introdução" heading at `bodyStart`) — needed to resolve the placeholder
 * `<w:pgNumType w:start="1"/>` `applyAbntPageNumbering` stamps onto the body
 * section. Reuses the sumário's own first-entry lookup when a sumário exists (the
 * first TOC entry, by construction of `buildSumario`, IS the `bodyStart` heading —
 * no extra render-text scan needed); otherwise scans `pageTexts` directly for the
 * heading's own text, since with no sumário there is no TOC-look-alike page to
 * skip past. Returns null if the heading text can't be found on any page (render
 * failed to produce recognizable text, or the block isn't a real paragraph).
 */
export function findBodyStartPage(documentXml: string, bodyStart: number, pageTexts: string[]): number | null {
  const entries = findSumarioEntries(documentXml)
  if (entries.length > 0) return assignEntryPages([entries[0].text], pageTexts)[0]

  const blocks = getBlocks(documentXml)
  const text = normalize(blockText(blocks[bodyStart] ?? ''))
  if (!text) return null
  const pageNorms = pageTexts.map(normalize)
  const idx = pageNorms.findIndex(p => p.includes(text))
  return idx < 0 ? null : idx + 1
}

/**
 * How many physical pages precede the display count's page 1 (folha de rosto) —
 * exactly the capa, when present, since NBR 14724 excludes it from the count and
 * the rest of this pipeline already guarantees it renders as exactly one page.
 */
export function abntCapaOffset(sections: { kind: string }[]): number {
  return sections.some(s => s.kind === 'capa') ? 1 : 0
}

/**
 * Resolve the placeholder `<w:pgNumType w:start="1"/>` (stamped by
 * `applyAbntPageNumbering`) with the real display start value, once known from a
 * render. A no-op if the placeholder isn't present (e.g. `bodyStart === 0`, so
 * `applyAbntPageNumbering` never ran).
 */
export function stampAbntPageNumberStart(documentXml: string, start: number): string {
  return documentXml.replace(/(<w:pgNumType\b[^>]*\bw:start=")\d+(")/, `$1${Math.max(start, 1)}$2`)
}
