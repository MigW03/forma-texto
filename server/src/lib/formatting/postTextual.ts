import { getBlocks, isParagraph, blockText } from './blocks'
import { detectPretextual } from './preTextual'
import { findSumarioEntries } from './sumarioPagination'

/**
 * Post-textual section detection — ABNT "Apêndice" (appendix) and "Anexo" (annex /
 * attachments). These sections ARE formatted and proofread like the rest of the
 * document (headings get the correct hierarchy, the text is corrected) and are
 * billed as ordinary laudas. The ONE thing the pipeline skips inside them is image
 * handling: an annex reproduces third-party documents (forms, maps, legislation)
 * whose images carry no caption/source of ours and must not be rescaled.
 *
 * `locateAppendixStart` returns the absolute block index of the FIRST such heading.
 * The image passes (resize / caption / source placeholders) stop at that index; the
 * references locator also stops there so an appendix is never mistaken for a citation
 * list. Every other pass treats the section like the rest of the document.
 */

/**
 * A heading-like paragraph: the whole text is the label ("Apêndice(s)"/"Anexo(s)"),
 * an optional enumerator (A, B, 1, II, IV…), and an optional "— Título". Anchored at
 * BOTH ends so an in-body mention ("o anexo A contém os formulários") never matches —
 * that is what lets us be case-insensitive and so accept EVERY casing: "ANEXO A",
 * "Anexo A", "Apêndice B — Questionário", "anexo i: mapa", etc.
 */
const APPENDIX_HEADING_RE =
  /^(?:ap[eê]ndices?|anexos?)(?:\s+[a-z0-9ivxlcdm]{1,4})?(?:\s*[-–—:]\s*\S.*)?$/i

/** True when a paragraph's text is an appendix/annex section heading (any casing). */
export function looksLikeAppendixHeading(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 120) return false
  return APPENDIX_HEADING_RE.test(t)
}

/**
 * Find the first appendix/annex heading in the document, or null if there is none.
 * Scans the whole document (the stored file may be sliced to a few laudas, so an
 * appendix can appear early); the uppercase heading test keeps false positives away.
 *
 * Skips any block inside a detected sumário section. Real bug this guards against:
 * `buildSumario` rebuilds its TOC entries from the real body headings, so a document
 * whose appendix heading is literally "Apêndices" gets a matching sumário entry —
 * with NO page number yet (that's filled in much later, by `paginateSumario`). That
 * bare "Apêndices" entry alone satisfies `looksLikeAppendixHeading` just as well as
 * the real heading does. `processFormatting` re-runs this function right after
 * `buildSumario` specifically because block count changed — without this exclusion
 * it locks onto the sumário's own echo instead of the real heading deep in the body,
 * freezing image/caption/placeholder detection for nearly the whole document. This
 * fires on any document that has BOTH a sumário and an appendix — standard ABNT
 * shape, not an edge case.
 *
 * `detectPretextual`'s own section boundary isn't trusted for the sumário's END: its
 * `bodyStart` heuristic only recognizes a TOC entry by trailing dot-leaders/a page
 * number, which a *freshly built* entry doesn't have yet — so right after
 * `buildSumario` the detected section can be too short, covering only the label.
 * `findSumarioEntries` recognizes `buildTocEntry`'s own structural signature instead
 * (right-tab + suppressAutoHyphens), independent of whether a page number is present,
 * so it correctly extends the exclusion range over every rebuilt entry.
 */
export function locateAppendixStart(documentXml: string): number | null {
  const blocks = getBlocks(documentXml)
  const sumario = detectPretextual(documentXml).sections.find(s => s.kind === 'sumario')
  let skipEnd = sumario?.blockEnd ?? -1
  if (sumario) {
    const entries = findSumarioEntries(documentXml)
    if (entries.length > 0) skipEnd = Math.max(skipEnd, entries[entries.length - 1].index)
  }
  for (let i = 0; i < blocks.length; i++) {
    if (sumario && i >= sumario.blockStart && i <= skipEnd) continue
    if (isParagraph(blocks[i]) && looksLikeAppendixHeading(blockText(blocks[i]))) return i
  }
  return null
}
