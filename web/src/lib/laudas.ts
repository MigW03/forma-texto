import { getDocxBlocks, type DocxBlock } from './docx-slice'
import { detectPretextual } from './pretextual'

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

/**
 * Walk blocks accumulating words; close a lauda at the block that first reaches
 * `wordsPerLauda`. Trailing blocks that don't reach the threshold form a final
 * lauda (round up); trailing *empty* blocks attach to the last lauda so slicing
 * stays lossless.
 *
 * The whole document is counted, including any appendix/annex (Apêndice / Anexo):
 * those post-textual sections are billed and formatted like the rest. (The server
 * still skips only image caption/source insertion inside them.)
 *
 * `bodyStart` excludes the pré-textual region: blocks `[0, bodyStart)` (capa, folha
 * de rosto, resumo, sumário, …) are not laudas — they are classified separately and
 * not billed. Block indices in the returned laudas stay ABSOLUTE, so divider/dimming
 * code maps them to the right rendered blocks unchanged.
 */
export function computeLaudas(
  blocks: Pick<DocxBlock, 'text'>[],
  wordsPerLauda = WORDS_PER_LAUDA,
  bodyStart = 0,
): Lauda[] {
  const laudas: Lauda[] = []
  let start = bodyStart
  let words = 0
  let n = 1
  for (let i = bodyStart; i < blocks.length; i++) {
    words += countWords(blocks[i].text)
    if (words >= wordsPerLauda) {
      laudas.push({ index: n++, blockStart: start, blockEnd: i, wordCount: words })
      start = i + 1
      words = 0
    }
  }
  if (start < blocks.length) {
    if (words > 0 || laudas.length === 0) {
      laudas.push({ index: n, blockStart: start, blockEnd: blocks.length - 1, wordCount: words })
    } else {
      // trailing empty paragraphs: keep them with the previous lauda (don't drop on slice)
      laudas[laudas.length - 1].blockEnd = blocks.length - 1
    }
  }
  return laudas
}

/**
 * Detect the pré-textual region and compute body laudas in one pass — the single
 * source of truth shared by page selection, checkout slicing, and recovery re-slicing
 * so lauda numbering is identical everywhere. `bodyStart` is the first body block;
 * `laudas` exclude the pré-textual region `[0, bodyStart)`.
 */
export function analyzeDocument(blocks: Pick<DocxBlock, 'text'>[]): {
  laudas: Lauda[]
  bodyStart: number
} {
  const { bodyStart } = detectPretextual(blocks)
  return { laudas: computeLaudas(blocks, WORDS_PER_LAUDA, bodyStart), bodyStart }
}

/**
 * Block indices to keep when slicing to `selectedLaudas`. The pré-textual region is
 * ALWAYS kept (capa, folha de rosto, resumo, sumário, … must travel with the document
 * even though they are not billable laudas), plus every block of the selected laudas.
 */
export function uploadKeepSet(
  blocks: Pick<DocxBlock, 'text'>[],
  selectedLaudas: Iterable<number>,
): Set<number> {
  const { laudas, bodyStart } = analyzeDocument(blocks)
  const keep = laudaBlockSet(laudas, selectedLaudas)
  for (let i = 0; i < bodyStart; i++) keep.add(i)
  return keep
}

/** Parse a DOCX and compute its laudas in one call. */
export async function getLaudas(file: File): Promise<Lauda[]> {
  return analyzeDocument(await getDocxBlocks(file)).laudas
}

/**
 * Block indices to keep when slicing to the given selected lauda numbers. Any
 * appendix/annex is part of the laudas like the rest of the document, so it is kept
 * only when its laudas are among the selected ones.
 */
export function laudaBlockSet(laudas: Lauda[], selectedIndices: Iterable<number>): Set<number> {
  const sel = new Set(selectedIndices)
  const keep = new Set<number>()
  for (const l of laudas) {
    if (sel.has(l.index)) {
      for (let i = l.blockStart; i <= l.blockEnd; i++) keep.add(i)
    }
  }
  return keep
}
