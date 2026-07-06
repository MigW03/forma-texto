import { getBlocks, blockText, replaceBlocks, MAX_HEADING_CHARS } from './blocks'
import { escapeXml } from './xmlText'
import type { PretextualResult } from './preTextual'

/**
 * Right tab stop position in twips for the page-number column.
 * A4 with ABNT margins (3cm left, 2cm right) → text width ≈ 16cm → ~9072 twips.
 */
const TOC_TAB_POS = 9072

/** Left indent in twips per heading level (level 1 = flush left). */
const LEVEL_INDENT: Record<number, number> = { 1: 0, 2: 709, 3: 1418 }

/** Return 1–6 when the block carries a Heading N style, else null. */
function headingLevel(block: string): number | null {
  const m = block.match(/<w:pStyle\b[^>]*w:val="Heading(\d)"/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 6 ? n : null
}

/**
 * Build one TOC entry paragraph for `text` at `level`. Page number left blank.
 * Explicitly resets justification and first-line indent — the entry carries no
 * `w:pStyle`, so it would otherwise inherit the body style (ABNT: justified, 1.25cm
 * first-line indent), stretching a short title across the full width and wrapping it.
 */
function buildTocEntry(text: string, level: number): string {
  const indent = LEVEL_INDENT[level] ?? (level - 1) * 709
  const rPr = level === 1 ? '<w:rPr><w:b/></w:rPr>' : ''
  return (
    '<w:p>' +
    '<w:pPr>' +
    `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${TOC_TAB_POS}"/></w:tabs>` +
    '<w:suppressAutoHyphens/>' +
    `<w:ind w:left="${indent}" w:firstLine="0"/>` +
    '<w:jc w:val="left"/>' +
    '</w:pPr>' +
    `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` +
    '<w:r><w:tab/></w:r>' +
    '</w:p>'
  )
}

/**
 * Rebuild the sumário section with TOC entries derived from Heading1–Heading3 paragraphs
 * in the body. The "SUMÁRIO" label paragraph is preserved; its content blocks
 * are replaced with one entry per body heading (H1 bold, H2/H3 indented).
 *
 * Page numbers are intentionally left blank — a right dot-leader tab stop is inserted
 * so the visual layout is correct, but the number is empty pending a render pass.
 *
 * Returns the document unchanged when no sumário section is detected or the body
 * contains no heading-styled paragraphs.
 */
export function buildSumario(
  documentXml: string,
  pretextual: PretextualResult,
): string {
  const sumarioSection = pretextual.sections.find(s => s.kind === 'sumario')
  if (!sumarioSection) return documentXml

  const blocks = getBlocks(documentXml)

  const entries: string[] = []
  for (let i = pretextual.bodyStart; i < blocks.length; i++) {
    const level = headingLevel(blocks[i])
    if (level === null) continue
    const text = blockText(blocks[i])
    // Second line of defense against a body paragraph left in a heading style by mistake —
    // `demoteImplausibleHeadings` (headingSanity.ts) fixes this at the source before this
    // pass runs, but this guard keeps the sumário safe even if that pass is ever skipped.
    if (!text || text.length > MAX_HEADING_CHARS) continue
    entries.push(buildTocEntry(text, level))
  }

  if (entries.length === 0) return documentXml

  const contentStart = sumarioSection.blockStart + 1
  const contentEnd = sumarioSection.blockEnd
  const byIndex = new Map<number, string>()

  if (contentStart > contentEnd) {
    // Sumário label is the only block — append entries right after it by
    // concatenating onto the label's slot (replaceBlocks does raw string replace).
    byIndex.set(sumarioSection.blockStart, (blocks[sumarioSection.blockStart] ?? '') + entries.join(''))
  } else {
    // Pack all new entries into the first content slot; delete the rest.
    byIndex.set(contentStart, entries.join(''))
    for (let i = contentStart + 1; i <= contentEnd; i++) byIndex.set(i, '')
  }

  return replaceBlocks(documentXml, byIndex)
}
