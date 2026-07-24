import { getBlocks, isParagraph, blockText, replaceBlocks } from './blocks'
import { isImageParagraph } from './captions'
import { REFERENCES_HEADING_STYLE } from './guidelines'

/** Paragraph styles `rewriteStyles` stamps with `<w:pageBreakBefore/>` (own document
 *  content only — Heading1 for chapters, ReferencesHeading for the reference list).
 *  Anything styled one of these will ALWAYS force a new page before it. */
const BREAKING_STYLES_RE = new RegExp(`<w:pStyle\\b[^>]*w:val="(?:Heading1|${REFERENCES_HEADING_STYLE})"`)

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
  return suppressPageBreakAt(documentXml, firstH1)
}

/**
 * Disable the `Heading1` style's `<w:pageBreakBefore/>` on a specific block, when that
 * block is itself a Heading1 that would still force one. Used wherever some OTHER
 * mechanism already guarantees the paragraph starts a fresh page (an OOXML section
 * break, or — via `suppressFirstHeadingPageBreak` — simply being the document's first
 * heading), so the style's own break would stack on top of it and render a blank page
 * (see `removeRedundantChapterPageBreaks` below for the same failure mode with manual
 * breaks). No-op when the index is out of range or isn't a breaking Heading1.
 */
export function suppressPageBreakAt(documentXml: string, index: number): string {
  const blocks = getBlocks(documentXml)
  if (index < 0 || index >= blocks.length) return documentXml
  let p = blocks[index]
  if (!isParagraph(p) || !/<w:pStyle\b[^>]*w:val="Heading1"/.test(p)) return documentXml

  // Drop any inherited/author page-break toggle on this paragraph, then disable it.
  p = p.replace(/<w:pageBreakBefore\b[^>]*\/>/g, '')
  // Place the override right after <w:pStyle/> (valid CT_PPr order; pStyle is present
  // because the paragraph is styled Heading1). Fall back to opening <w:pPr> if not.
  if (/<w:pStyle\b[^>]*\/>/.test(p)) {
    p = p.replace(/(<w:pStyle\b[^>]*\/>)/, '$1<w:pageBreakBefore w:val="false"/>')
  } else if (/<w:pPr\b[^>]*>/.test(p)) {
    p = p.replace(/(<w:pPr\b[^>]*>)/, '$1<w:pageBreakBefore w:val="false"/>')
  }
  if (p === blocks[index]) return documentXml

  return replaceBlocks(documentXml, new Map([[index, p]]))
}

/** A manual ("hard") page break: `<w:br w:type="page"/>`. */
const PAGE_BR_RE = /<w:br\b[^>]*\bw:type="page"[^>]*\/>/g
/** A `<w:t>` node carrying at least one actual character (an empty `<w:t></w:t>` or a
 *  `<w:tab/>` does not match — only real text content counts as the chapter's body). */
const HAS_TEXT_RE = /<w:t\b[^>]*>[^<]/

/**
 * True when a paragraph is styled with one of `BREAKING_STYLES_RE` and will STILL force
 * a page break before it — i.e. it carries no `<w:pageBreakBefore w:val="false">`
 * override. Those styles add `<w:pageBreakBefore/>` (so every chapter, and the
 * references list, start a new page); the first H1 in the document gets the `false`
 * override from `suppressFirstHeadingPageBreak`, so it is correctly excluded here.
 */
function headingForcesBreak(block: string): boolean {
  if (!isParagraph(block) || !BREAKING_STYLES_RE.test(block)) return false
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
 * Remove the redundant manual page break that authors often place before a chapter
 * title, or before their reference list.
 *
 * `Heading1` and `ReferencesHeading` (`BREAKING_STYLES_RE`) already break the page on
 * their own (`pageBreakBefore`). When the author ALSO inserted a manual page break just
 * before the paragraph — a standalone `<w:br w:type="page"/>` paragraph, or one trailing
 * the previous paragraph's last content, sometimes wrapped in `<w:tab/>` runs by a
 * Google Docs export — the document then carries TWO breaks. Word silently collapses
 * them, but LibreOffice (our PDF exporter) honours both and renders a blank page in
 * between.
 *
 * For each such heading that still forces a break, this drops any manual break inside
 * the heading itself and any standalone/trailing manual break in the gap before it (walking
 * back over empty/break-only paragraphs until the previous paragraph's real content). The
 * style's own break remains, so the section still starts on a fresh page — minus the blank one.
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

/** True when `b` is an empty spacer paragraph — no visible text and not an image. */
function isBlankParagraph(b: string): boolean {
  return isParagraph(b) && !isImageParagraph(b) && blockText(b) === ''
}

/**
 * Remove a trailing blank page at the very END of the document.
 *
 * Two independent shapes produce one:
 *  1. A manual page break trailing the last real content, with nothing after it to
 *     ever render on the page it starts — e.g. an author's stray `Ctrl+Enter` at the
 *     end of the doc, or the last chapter's closing paragraph carrying a break left
 *     over from editing. `stripTrailingPageBreaks` already strips this shape when it
 *     sits before a chapter heading; this covers the same shape at the document's tail,
 *     where there is no following heading to anchor the walk-back onto.
 *  2. One or more blank spacer paragraphs after the last real content — ordinarily
 *     harmless, but if one of them is (mis)styled `Heading1` it carries the style's own
 *     `<w:pageBreakBefore/>` and forces a page that then has nothing else to show. Since
 *     these paragraphs carry no visible content by definition, deleting them can't lose
 *     anything, regardless of why they're there.
 *
 * No-op when the document has no trailing blank run (the common case).
 */
export function removeTrailingBlankPages(documentXml: string): string {
  const blocks = getBlocks(documentXml)

  let lastContent = blocks.length - 1
  while (lastContent >= 0 && isParagraph(blocks[lastContent]) && isBlankParagraph(blocks[lastContent])) {
    lastContent--
  }
  if (lastContent < 0) return documentXml // whole document is blank — never touch it

  const edits = new Map<number, string>()
  for (let i = lastContent + 1; i < blocks.length; i++) edits.set(i, '')

  if (isParagraph(blocks[lastContent])) {
    const strippedLast = stripTrailingPageBreaks(blocks[lastContent])
    if (strippedLast !== blocks[lastContent]) edits.set(lastContent, strippedLast)
  }

  return edits.size ? replaceBlocks(documentXml, edits) : documentXml
}
