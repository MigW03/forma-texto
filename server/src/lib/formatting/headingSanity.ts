import { getBlocks, isParagraph, isListItem, blockText, clearHeadingStyle, replaceBlocks, MAX_HEADING_CHARS } from './blocks'
import { isImageParagraph, FIGURE_LABEL_RE, TABLE_LABEL_RE } from './captions'

const HEADING_STYLE_RE = /<w:pStyle\b[^>]*w:val="(Title|Heading[1-6])"/i

/** True when a block is a figure/table caption label ("Figura 4:", "Tabela 2 -"). */
function isCaptionLabel(b: string | undefined): boolean {
  if (!b || !isParagraph(b)) return false
  const text = blockText(b)
  return FIGURE_LABEL_RE.test(text) || TABLE_LABEL_RE.test(text)
}

/** True when `b` is an empty spacer paragraph — no visible text AND not an image (an
 *  image paragraph also has no `<w:t>` text, but it must never be skipped as "blank"). */
function isBlankParagraph(b: string | undefined): boolean {
  return !!b && isParagraph(b) && !isImageParagraph(b) && blockText(b) === ''
}

/**
 * True when the very next non-blank block (skipping at most one blank spacer paragraph)
 * is a figure/table caption label or the image itself — i.e. `blocks[i]` is really a
 * figure's lead-in description sentence, not a chapter/section heading. A real heading
 * is essentially never immediately followed, with no body prose in between, by a
 * "Figura N:" label — that shape only happens when an author's descriptive sentence
 * right before a figure got left in (or promoted to) a heading style by mistake.
 */
function immediatelyPrecedesCaption(blocks: string[], i: number): boolean {
  let j = i + 1
  if (isBlankParagraph(blocks[j])) j++
  const next = blocks[j]
  return next !== undefined && (isImageParagraph(next) || isCaptionLabel(next))
}

/**
 * Demote paragraphs that carry a Title/Heading style but are implausible as a real
 * heading:
 *  1. **Far too long** — almost always a body paragraph left in a heading style by an
 *     authoring mistake (the writer typed a subheading, hit enter, and kept typing the
 *     next paragraph without switching back to Normal).
 *  2. **Sits immediately before a figure/table caption label or image** — a short
 *     descriptive sentence introducing a figure (e.g. "Com 800 metros quadrados, este
 *     painel é o maior da série…") that the author bolded/styled as a heading. Under
 *     `MAX_HEADING_CHARS` it evades signal (1), so it rendered as a bogus subheading in
 *     the body, got swept into the sumário as a TOC entry, and — because Heading styles
 *     carry their own page-break/keep-together rules that don't account for the figure
 *     that follows — could end up stranded on a page with no image to go with it while
 *     the actual "Figura N:"/image/source group moved to the next page.
 *
 * Left uncorrected, either case renders as an oversized or out-of-place bold "heading"
 * in the body and gets swept into the sumário as a bogus TOC entry.
 *
 * Runs deterministically, before Step D, so the AI headings pass — which only ever
 * PROMOTES, never demotes, by design (see stepD.ts) — never has to reason about it, and
 * `buildSumario` never sees it either.
 *
 * Never touches the labeled pré-textual headings (RESUMO, SUMÁRIO, …) — those carry
 * `ReferencesHeading`, not Title/Heading1-6, so they never match here.
 */
export function demoteImplausibleHeadings(documentXml: string): string {
  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    if (!isParagraph(b) || isListItem(b)) return
    if (!HEADING_STYLE_RE.test(b)) return
    const tooLong = blockText(b).length > MAX_HEADING_CHARS
    const isCaptionLeadIn = immediatelyPrecedesCaption(blocks, i)
    if (!tooLong && !isCaptionLeadIn) return
    byIndex.set(i, clearHeadingStyle(b))
  })
  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}
