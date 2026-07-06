import { getBlocks, replaceBlocks } from './blocks'
import { paragraphText, spliceCorrectedText, canSpliceParagraph } from './runs'

/**
 * Heading numbering (ABNT NBR 6024) — chapter/section headings are numbered
 * progressively (`1`, `1.1`, `1.1.1`, …), while unnumbered titles (RESUMO,
 * SUMÁRIO, REFERÊNCIAS, …) stay bare. Those unnumbered titles already carry a
 * different style (`REFERENCES_HEADING_STYLE`, stamped by `applyPretextualHeadings`
 * / Step B), never `Heading1/2/3`, so scanning only `Heading1/2/3` paragraphs
 * naturally excludes them.
 *
 * Authors are inconsistent — some type numbers, some don't, some skip a level.
 * This pass **always renumbers every `Heading1/2/3` paragraph** in document
 * order, regardless of what the author originally typed, so the final document
 * has one uniform, correct sequence — matching the ABNT rule rather than
 * merely "fixing" a detected inconsistency.
 *
 * Runs after Step D (so it sees every promoted heading) and before the sumário
 * rebuild (so TOC entries carry the same numbers). Excludes the appendix/annex
 * region (`stopIndex`) — `APÊNDICE A` / `ANEXO B` are letter-labeled per ABNT,
 * not part of the sequential chapter numbering, even if Step D happened to
 * style one `Heading1`.
 *
 * Known limitation: only recognizes the standard Arabic-numeral prefix
 * (`1`, `1.1`, `1.1.1`, with an optional trailing dot). A heading using a
 * different scheme (`Capítulo 1`, roman numerals) is treated as unprefixed —
 * the correct number is prepended in front of it rather than replacing it.
 */

/** Return 1–3 when the block carries a Heading1/2/3 style, else null. */
function headingLevel(block: string): 1 | 2 | 3 | null {
  const m = block.match(/<w:pStyle\b[^>]*w:val="Heading([123])"/i)
  return m ? (Number(m[1]) as 1 | 2 | 3) : null
}

/** A leading `1`, `1.1`, or `1.1.1` numeral, with an optional trailing dot, then whitespace. */
const NUMBER_PREFIX_RE = /^\d+(?:\.\d+)*\.?\s+/

/** Strip a pre-existing numeric prefix, if any, to recover the bare title text. */
function stripNumberPrefix(text: string): string {
  return text.replace(NUMBER_PREFIX_RE, '')
}

/** Make sure every counter ABOVE `level` (1-based) has started, defaulting an unseen ancestor to 1. */
function ensureAncestors(counters: number[], level: number): void {
  for (let j = 0; j < level - 1; j++) {
    if (counters[j] === 0) counters[j] = 1
  }
}

/** Increment this level's counter and reset every deeper one. */
function bump(counters: number[], level: number): void {
  counters[level - 1] += 1
  for (let j = level; j < counters.length; j++) counters[j] = 0
}

export interface HeadingNumberingOptions {
  /** First body block index; headings before it (pré-textual front matter) are skipped. 0 = none. */
  bodyStartIndex?: number
  /** First block at/after which numbering stops (the appendix/annex region). undefined = no cutoff. */
  stopIndex?: number
}

/**
 * Renumber every `Heading1/2/3` paragraph in `[bodyStartIndex, stopIndex)` with a
 * sequential ABNT-style number (`1`, `1.1`, `1.1.1`, …), replacing any existing
 * numeric prefix. Text is rewritten via the same run-preserving splice Step P
 * uses (`spliceCorrectedText`), so bold/italic/other run formatting on the
 * heading survives; a heading that is unsafe to splice (hyperlink/field/footnote)
 * keeps its original text but still occupies a slot in the numbering sequence.
 */
export function applyHeadingNumbering(
  documentXml: string,
  { bodyStartIndex = 0, stopIndex }: HeadingNumberingOptions = {},
): string {
  const blocks = getBlocks(documentXml)
  const end = stopIndex ?? blocks.length
  const counters = [0, 0, 0]
  const byIndex = new Map<number, string>()

  for (let i = bodyStartIndex; i < end; i++) {
    const level = headingLevel(blocks[i])
    if (level === null) continue

    ensureAncestors(counters, level)
    bump(counters, level)
    const number = counters.slice(0, level).join('.')

    const text = paragraphText(blocks[i])
    const bare = stripNumberPrefix(text)
    if (!bare) continue // no visible text to number
    const numbered = `${number} ${bare}`
    if (numbered === text) continue
    if (!canSpliceParagraph(blocks[i])) continue

    const spliced = spliceCorrectedText(blocks[i], numbered)
    if (spliced) byIndex.set(i, spliced)
  }

  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}
