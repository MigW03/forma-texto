import { getBlocks, isParagraph, blockText } from './blocks'

/**
 * Post-textual section detection — ABNT "Apêndice" (appendix) and "Anexo" (annex /
 * attachments). These sections must NOT be proofread or reformatted: an appendix
 * holds the author's own supporting material and an annex reproduces third-party
 * documents (forms, maps, legislation) whose layout must survive byte-for-byte.
 *
 * `locateAppendixStart` returns the absolute block index of the FIRST such heading.
 * Everything from that index onward is frozen by the pipeline — every pass receives
 * it as a cutoff — but the blocks are never removed, so the section still ships in
 * the downloaded file.
 */

// A heading that opens with "Apêndice", "Apêndices", "Anexo" or "Anexos" — optionally
// followed by a letter/number and a title ("ANEXO A — Questionário"). Case-insensitive
// for the word match; the uppercase check below is what gives confidence.
const APPENDIX_HEADING_RE = /^(?:ap[eê]ndices?|anexos?)\b/i

/**
 * True when a paragraph's text is an appendix/annex section heading. ABNT writes these
 * titles in UPPERCASE; requiring the leading label to be uppercase is what separates a
 * real section heading ("ANEXO A — …") from an in-body mention ("ver anexo A").
 */
export function looksLikeAppendixHeading(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 120) return false
  if (!APPENDIX_HEADING_RE.test(t)) return false
  const lead = t.split(/\s+/)[0]
  // Has cased letters AND they are uppercase (digits-only would equal both forms).
  return lead === lead.toUpperCase() && lead !== lead.toLowerCase()
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
