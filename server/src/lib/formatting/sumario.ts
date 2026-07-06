import { getBlocks, blockText, replaceBlocks, MAX_HEADING_CHARS } from './blocks'
import { escapeXml } from './xmlText'
import type { PretextualResult } from './preTextual'

/**
 * Fallback right-tab position (twips) for the page-number column when the document
 * carries no readable `<w:sectPr>`: A4 with ABNT margins (3cm left, 2cm right) →
 * text width = 11906 − 1701 − 1134 = 9071 twips, minus a small safety inset.
 *
 * The tab MUST sit inside the text width. The previous constant (9072) was 1 twip
 * PAST it, which made docx-preview push the tab (and its dot leader) off the right
 * edge and wrap every entry onto a second line.
 */
const FALLBACK_TAB_POS = 9061

/** Safety inset (twips) so rounding in any renderer never pushes the tab past the margin. */
const TAB_INSET = 10

/** Left indent in twips per heading level (level 1 = flush left). */
const LEVEL_INDENT: Record<number, number> = { 1: 0, 2: 709, 3: 1418 }

/** Return 1–6 when the block carries a Heading N style, else null. */
function headingLevel(block: string): number | null {
  const m = block.match(/<w:pStyle\b[^>]*w:val="Heading(\d)"/i)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 6 ? n : null
}

/** Read a twips attribute (e.g. `w:left="1701"`) off an OOXML tag string. */
function twipAttr(tag: string, attr: string): number {
  const m = tag.match(new RegExp(`${attr}="(\\d+)"`))
  return m ? parseInt(m[1], 10) : 0
}

/**
 * Right-tab position for the sumário's page-number column, derived from the
 * document's own final `<w:sectPr>` (page width minus margins, minus a small
 * inset). Falls back to the ABNT A4 constant when the section properties are
 * missing or unreadable.
 */
export function sumarioTabPos(documentXml: string): number {
  const finalSectPr = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/)?.[0]
  if (!finalSectPr) return FALLBACK_TAB_POS
  const pgSz = finalSectPr.match(/<w:pgSz\b[^>]*\/>/)?.[0]
  const pgMar = finalSectPr.match(/<w:pgMar\b[^>]*\/>/)?.[0]
  if (!pgSz || !pgMar) return FALLBACK_TAB_POS
  const contentW = twipAttr(pgSz, 'w:w') - twipAttr(pgMar, 'w:left') - twipAttr(pgMar, 'w:right')
  return contentW > TAB_INSET ? contentW - TAB_INSET : FALLBACK_TAB_POS
}

/**
 * Build one TOC entry paragraph for `text` at `level`. Page number left blank —
 * `paginateSumario` fills it at the very end of the pipeline, once real page
 * numbers exist. The tab is a plain right tab (no dot leader): docx-preview
 * renders leader dots poorly (they read as dashes spilling off the page), and the
 * user asked for them gone.
 *
 * Explicitly resets justification and first-line indent — the entry carries no
 * `w:pStyle`, so it would otherwise inherit the body style (ABNT: justified, 1.25cm
 * first-line indent), stretching a short title across the full width and wrapping it.
 * The left indent doubles as a hanging indent (`w:hanging="0"` via firstLine 0), so a
 * genuinely long title wraps under its own first character, never under the number.
 */
function buildTocEntry(text: string, level: number, tabPos: number): string {
  const indent = LEVEL_INDENT[level] ?? (level - 1) * 709
  const rPr = level === 1 ? '<w:rPr><w:b/></w:rPr>' : ''
  return (
    '<w:p>' +
    '<w:pPr>' +
    `<w:tabs><w:tab w:val="right" w:pos="${tabPos}"/></w:tabs>` +
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
 * Page numbers are intentionally left blank here — a right tab stop is inserted so the
 * layout is correct, and `paginateSumario` (the pipeline's LAST step) fills the numbers
 * from a real LibreOffice render once every other pass has settled the pagination.
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
  const tabPos = sumarioTabPos(documentXml)

  const entries: string[] = []
  for (let i = pretextual.bodyStart; i < blocks.length; i++) {
    const level = headingLevel(blocks[i])
    if (level === null) continue
    const text = blockText(blocks[i])
    // Second line of defense against a body paragraph left in a heading style by mistake —
    // `demoteImplausibleHeadings` (headingSanity.ts) fixes this at the source before this
    // pass runs, but this guard keeps the sumário safe even if that pass is ever skipped.
    if (!text || text.length > MAX_HEADING_CHARS) continue
    entries.push(buildTocEntry(text, level, tabPos))
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
