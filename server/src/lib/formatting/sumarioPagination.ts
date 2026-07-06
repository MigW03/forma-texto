import { getBlocks, replaceBlocks } from './blocks'
import { decodeXmlEntities } from './xmlText'
import { detectPretextual } from './preTextual'

/**
 * Sumário pagination — fills the page-number column of the TOC entries that
 * `buildSumario` created, using per-page text extracted from a REAL render of the
 * final document (LibreOffice → PDF, see `lib/paginateSumario.ts`).
 *
 * This module is pure (XML + strings in, XML out) so it is unit-testable without
 * LibreOffice; the render/IO wrapper lives outside `formatting/`.
 *
 * Numbers are the PHYSICAL 1-based PDF page numbers: the document carries no printed
 * header page numbers yet, so the sumário must match what a reader actually sees in
 * the exported PDF viewer. The ABNT folha-de-rosto counting convention (capa excluded
 * from the count) should land together with the future header page-numbering pass —
 * the two must shift in lockstep or they contradict each other.
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
 */
function setEntryPageNumber(entry: string, n: number): string {
  const re = /(<w:r><w:tab\/><\/w:r>)(<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>\d+<\/w:t><\/w:r>)?(<\/w:p>)$/
  if (!re.test(entry)) return entry
  return entry.replace(re, `$1<w:r><w:t>${n}</w:t></w:r>$3`)
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
 * per-page text (from the PDF render). Entries whose heading text is not found on
 * any body page keep a blank number. Block count never changes.
 */
export function applySumarioPageNumbers(documentXml: string, pageTexts: string[]): SumarioPaginationResult {
  const entries = findSumarioEntries(documentXml)
  if (entries.length === 0) return { documentXml, assigned: 0, total: 0 }

  const pages = assignEntryPages(entries.map(e => e.text), pageTexts)
  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  entries.forEach((e, k) => {
    const n = pages[k]
    if (n === null || n < 1) return
    const next = setEntryPageNumber(blocks[e.index], n)
    if (next !== blocks[e.index]) byIndex.set(e.index, next)
  })

  return {
    documentXml: byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml,
    assigned: byIndex.size,
    total: entries.length,
  }
}
