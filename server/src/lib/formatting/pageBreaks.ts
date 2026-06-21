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

/** A manual ("hard") page break: `<w:br w:type="page"/>`. */
const PAGE_BR_RE = /<w:br\b[^>]*\bw:type="page"[^>]*\/>/g
/** A `<w:t>` node carrying at least one actual character (an empty `<w:t></w:t>` or a
 *  `<w:tab/>` does not match — only real text content counts as the chapter's body). */
const HAS_TEXT_RE = /<w:t\b[^>]*>[^<]/

/**
 * True when a paragraph is a `Heading1` that will STILL force a page break before it —
 * i.e. it carries no `<w:pageBreakBefore w:val="false">` override. The `Heading1` style
 * adds `<w:pageBreakBefore/>` (so every chapter starts a new page); the first H1 gets the
 * `false` override from `suppressFirstHeadingPageBreak`, so it is correctly excluded here.
 */
function headingForcesBreak(block: string): boolean {
  if (!isParagraph(block) || !/<w:pStyle\b[^>]*w:val="Heading1"/.test(block)) return false
  return !/<w:pageBreakBefore\b[^>]*w:val="(?:false|0)"/.test(block)
}

/** Strip page breaks that have no text after them (a standalone break-only paragraph, or
 *  one trailing the paragraph's last text). A break still followed by text is left alone. */
function stripTrailingPageBreaks(p: string): string {
  return p.replace(PAGE_BR_RE, (m, offset: number) =>
    HAS_TEXT_RE.test(p.slice(offset + m.length)) ? m : '',
  )
}

/**
 * Remove the redundant manual page break that authors often place before a chapter title.
 *
 * The `Heading1` style already breaks the page before every chapter (`pageBreakBefore`).
 * When the author ALSO inserted a manual page break just before the title — a standalone
 * `<w:br w:type="page"/>` paragraph, or one trailing the previous chapter's last paragraph
 * — the document then carries TWO breaks. Word silently collapses them, but LibreOffice
 * (our PDF exporter) honours both and renders a blank page between the chapters.
 *
 * For each chapter heading that still forces a break, this drops any manual break inside
 * the heading itself and any standalone/trailing manual break in the gap before it (walking
 * back over empty/break-only paragraphs until the previous chapter's content). The style's
 * break remains, so each chapter still starts on a fresh page — minus the blank one.
 *
 * Runs AFTER `suppressFirstHeadingPageBreak`, so the first H1 (whose break is cancelled) is
 * never treated as "forcing a break" and its preceding manual break, if any, is preserved.
 */
export function removeRedundantChapterPageBreaks(documentXml: string): string {
  const blocks = getBlocks(documentXml)
  const edits = new Map<number, string>()
  const current = (i: number) => edits.get(i) ?? blocks[i]

  for (let i = 0; i < blocks.length; i++) {
    if (!headingForcesBreak(blocks[i])) continue

    // 1. A chapter title should never carry its own page break — drop any.
    const heading = current(i).replace(PAGE_BR_RE, '')
    if (heading !== blocks[i]) edits.set(i, heading)

    // 2. Walk back over the gap before the title, removing redundant manual breaks until
    //    we reach the previous chapter's content (a text-bearing paragraph).
    for (let j = i - 1; j >= 0; j--) {
      const block = current(j)
      if (!isParagraph(block)) break
      const stripped = stripTrailingPageBreaks(block)
      if (stripped !== block) edits.set(j, stripped)
      if (HAS_TEXT_RE.test(block)) break // previous chapter's content — stop here
    }
  }

  return edits.size ? replaceBlocks(documentXml, edits) : documentXml
}
