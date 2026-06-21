import { getBlocks, isParagraph, blockText } from './blocks'

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
 */
export function locateAppendixStart(documentXml: string): number | null {
  const blocks = getBlocks(documentXml)
  for (let i = 0; i < blocks.length; i++) {
    if (isParagraph(blocks[i]) && looksLikeAppendixHeading(blockText(blocks[i]))) return i
  }
  return null
}
