import { getDocxBlocks, type DocxBlock } from './docx-slice'

/**
 * A "lauda" is the Brazilian standard text unit (~300 words). We bill and slice
 * by laudas instead of pages because `.docx` has no reliable page metadata.
 *
 * Boundaries snap to whole paragraphs: a lauda is a contiguous run of body blocks
 * whose cumulative word count first reaches `WORDS_PER_LAUDA`. The trailing
 * remainder is always its own lauda (round up), so total laudas ≈ ceil(words/300).
 */
export interface Lauda {
  /** 1-based lauda number, shown in the UI ("Lauda 1", "Lauda 2", …). */
  index: number
  /** First body-block index (inclusive) — see DocxBlock indices in docx-slice.ts. */
  blockStart: number
  /** Last body-block index (inclusive). */
  blockEnd: number
  /** Words contained in this lauda (whitespace-separated tokens across its blocks). */
  wordCount: number
}

export const WORDS_PER_LAUDA = 300

/** Whitespace-separated token count. Empty / whitespace-only text → 0. */
export function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

// Mirror of the server's appendix/annex detection (server/src/lib/formatting/postTextual.ts).
// ABNT post-textual sections (Apêndice / Anexo) are NOT billed or processed — but they
// stay in the file. The pattern is anchored at both ends (the whole paragraph is the
// label + optional enumerator + optional "— título") so an in-body mention is never
// matched, which lets it accept every casing ("ANEXO A", "Anexo A", "anexo i: mapa").
const APPENDIX_HEADING_RE =
  /^(?:ap[eê]ndices?|anexos?)(?:\s+[a-z0-9ivxlcdm]{1,4})?(?:\s*[-–—:]\s*\S.*)?$/i

function looksLikeAppendixHeading(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 120) return false
  return APPENDIX_HEADING_RE.test(t)
}

/**
 * Index of the first appendix/annex block, or null. Everything from here on is the
 * frozen post-textual section: kept in the file, but excluded from laudas (not billed).
 */
export function findAppendixBlock(blocks: Pick<DocxBlock, 'text'>[]): number | null {
  for (let i = 0; i < blocks.length; i++) {
    if (looksLikeAppendixHeading(blocks[i].text)) return i
  }
  return null
}

/**
 * Walk blocks accumulating words; close a lauda at the block that first reaches
 * `wordsPerLauda`. Trailing blocks that don't reach the threshold form a final
 * lauda (round up); trailing *empty* blocks attach to the last lauda so slicing
 * stays lossless.
 */
export function computeLaudas(blocks: Pick<DocxBlock, 'text'>[], wordsPerLauda = WORDS_PER_LAUDA): Lauda[] {
  // Stop the lauda count at the appendix/annex boundary — that section is not billed
  // (the slicer keeps its blocks separately so it still ships in the file).
  const appendixAt = findAppendixBlock(blocks)
  const limit = appendixAt ?? blocks.length

  const laudas: Lauda[] = []
  let start = 0
  let words = 0
  let n = 1
  for (let i = 0; i < limit; i++) {
    words += countWords(blocks[i].text)
    if (words >= wordsPerLauda) {
      laudas.push({ index: n++, blockStart: start, blockEnd: i, wordCount: words })
      start = i + 1
      words = 0
    }
  }
  if (start < limit) {
    if (words > 0 || laudas.length === 0) {
      laudas.push({ index: n, blockStart: start, blockEnd: limit - 1, wordCount: words })
    } else {
      // trailing empty paragraphs: keep them with the previous lauda (don't drop on slice)
      laudas[laudas.length - 1].blockEnd = limit - 1
    }
  }
  return laudas
}

/** Parse a DOCX and compute its laudas in one call. */
export async function getLaudas(file: File): Promise<Lauda[]> {
  return computeLaudas(await getDocxBlocks(file))
}

/**
 * Block indices to keep when slicing to the given selected lauda numbers. When the full
 * block list is passed, the appendix/annex section (which is not a billable lauda) is
 * ALWAYS kept, so the frozen post-textual section survives into the uploaded file even
 * when the user selects only a subset of laudas.
 */
export function laudaBlockSet(
  laudas: Lauda[],
  selectedIndices: Iterable<number>,
  allBlocks?: Pick<DocxBlock, 'text'>[],
): Set<number> {
  const sel = new Set(selectedIndices)
  const keep = new Set<number>()
  for (const l of laudas) {
    if (sel.has(l.index)) {
      for (let i = l.blockStart; i <= l.blockEnd; i++) keep.add(i)
    }
  }
  if (allBlocks) {
    const appendixAt = findAppendixBlock(allBlocks)
    if (appendixAt !== null) {
      for (let i = appendixAt; i < allBlocks.length; i++) keep.add(i)
    }
  }
  return keep
}
