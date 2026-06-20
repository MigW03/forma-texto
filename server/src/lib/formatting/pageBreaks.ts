import { getBlocks, isParagraph, replaceBlocks } from './blocks'

/**
 * Cancel the page break before the FIRST `Heading1` in the document.
 *
 * The `Heading1` style carries `<w:pageBreakBefore/>` (see `rewriteStyles`) so
 * every top-level section starts on a new page. But the very first H1 must NOT:
 * a leading page break would either push a lone title onto its own page, or add
 * a blank page right after a cover / front matter that the source already
 * paginated. A direct `<w:pageBreakBefore w:val="false"/>` on that one paragraph
 * overrides the style for it alone; every later H1 keeps the break.
 *
 * Runs late in the pipeline (after Step D), because the first H1 may be a
 * paragraph the AI heading pass just promoted, not one the author styled.
 */
export function suppressFirstHeadingPageBreak(documentXml: string): string {
  const blocks = getBlocks(documentXml)
  const firstH1 = blocks.findIndex(
    b => isParagraph(b) && /<w:pStyle\b[^>]*w:val="Heading1"/.test(b),
  )
  if (firstH1 < 0) return documentXml

  let p = blocks[firstH1]
  // Drop any inherited/author page-break toggle on this paragraph, then disable it.
  p = p.replace(/<w:pageBreakBefore\b[^>]*\/>/g, '')
  // Place the override right after <w:pStyle/> (valid CT_PPr order; pStyle is present
  // because the paragraph is styled Heading1). Fall back to opening <w:pPr> if not.
  if (/<w:pStyle\b[^>]*\/>/.test(p)) {
    p = p.replace(/(<w:pStyle\b[^>]*\/>)/, '$1<w:pageBreakBefore w:val="false"/>')
  } else if (/<w:pPr\b[^>]*>/.test(p)) {
    p = p.replace(/(<w:pPr\b[^>]*>)/, '$1<w:pageBreakBefore w:val="false"/>')
  }

  return replaceBlocks(documentXml, new Map([[firstH1, p]]))
}
