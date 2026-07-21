import { getBlocks, blockText, MAX_HEADING_CHARS } from './blocks'
import { headingLevel } from './sumario'
import { findSumarioEntries } from './sumarioPagination'
import type { PretextualResult } from './preTextual'
import type { ReferenceRegion } from './references'

/**
 * Output-validation backstop — the last gate before a formatted document is
 * stamped `complete`. Independent of whether the AI passes succeeded, this
 * catches the deterministic-bug class (malformed XML, a corrupted sumário, an
 * unresolved page-number placeholder, a references page the pipeline silently
 * failed to locate) that unit tests keep missing on real documents. A
 * validation failure must never ship — the caller routes it to the same
 * retriable-failure path as any other pipeline error (see `processFormatting`).
 *
 * Pure (XML + a few pipeline-computed facts in, issues out) so it's testable
 * without a real DOCX or a LibreOffice render.
 */

export interface ValidationIssue {
  code: string
  message: string
}

export interface ValidationContext {
  /** Final pré-textual detection (sections + bodyStart), post sumário rebuild. */
  pretextual: PretextualResult
  /** Whether the user flagged any references page(s) for this project. */
  referencesFlagged: boolean
  /** The located references region, or null if none was found. */
  referenceRegion: ReferenceRegion | null
}

const RED_PLACEHOLDER_RE = /\[inserir (?:legenda da (?:figura|tabela)|fonte)\]/i

/** XML 1.0 predefined entities + numeric character references. */
const VALID_ENTITY_RE = /^(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/

/**
 * A minimal well-formedness scanner: balanced tag nesting (respecting quoted
 * attribute values, comments, processing instructions and CDATA) plus no bare
 * `&` outside a recognized entity. Not a full XML validator — just enough to
 * catch the corruption modes this pipeline has actually produced (a stray
 * control character breaking the whole part, a block-splitting bug leaving a
 * dangling close tag). Returns the first error found, or null when well-formed.
 */
function checkWellFormed(xml: string): string | null {
  const stack: string[] = []
  let i = 0
  const n = xml.length

  while (i < n) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) {
      // Trailing text after the last tag — still needs entity checking.
      const err = checkEntities(xml, i, n)
      if (err) return err
      break
    }
    const err = checkEntities(xml, i, lt)
    if (err) return err

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4)
      if (end === -1) return 'unterminated comment'
      i = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9)
      if (end === -1) return 'unterminated CDATA section'
      i = end + 3
      continue
    }
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2)
      if (end === -1) return 'unterminated processing instruction'
      i = end + 2
      continue
    }

    const tagEnd = findTagEnd(xml, lt)
    if (tagEnd === -1) return `unterminated tag starting at offset ${lt}`
    const tag = xml.slice(lt, tagEnd + 1)

    if (tag.startsWith('</')) {
      const name = tag.match(/^<\/([^\s>]+)/)?.[1]
      if (!name) return `malformed close tag at offset ${lt}`
      const top = stack.pop()
      if (top !== name) return `mismatched close tag </${name}> at offset ${lt} (expected ${top ? `</${top}>` : 'no open tag'})`
    } else if (tag.endsWith('/>')) {
      // self-closing — no stack change
    } else {
      const name = tag.match(/^<([^\s>/]+)/)?.[1]
      if (!name) return `malformed open tag at offset ${lt}`
      stack.push(name)
    }
    i = tagEnd + 1
  }

  if (stack.length > 0) return `unclosed tag(s) at end of document: ${stack.slice(-3).join(', ')}`
  return null
}

/** Index of the `>` that closes the tag opened at `start` (respects quoted attribute values). */
function findTagEnd(xml: string, start: number): number {
  let i = start + 1
  let quote: '"' | "'" | null = null
  for (; i < xml.length; i++) {
    const c = xml[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '>') {
      return i
    }
  }
  return -1
}

/** Scan text content `xml[from, to)` for a bare `&` not part of a recognized entity. */
function checkEntities(xml: string, from: number, to: number): string | null {
  let idx = xml.indexOf('&', from)
  while (idx !== -1 && idx < to) {
    if (!VALID_ENTITY_RE.test(xml.slice(idx + 1, idx + 12))) {
      return `unescaped '&' at offset ${idx}`
    }
    idx = xml.indexOf('&', idx + 1)
  }
  return null
}

/**
 * Count Heading1–3 paragraphs in the body, using the exact same predicate
 * `buildSumario` uses to decide what becomes a TOC entry — so this count and
 * the sumário's real entry count are always comparing like with like.
 */
function countBodyHeadings(documentXml: string, bodyStart: number): number {
  const blocks = getBlocks(documentXml)
  let count = 0
  for (let i = bodyStart; i < blocks.length; i++) {
    const level = headingLevel(blocks[i])
    if (level === null) continue
    const text = blockText(blocks[i])
    if (!text || text.length > MAX_HEADING_CHARS) continue
    count++
  }
  return count
}

/**
 * Validate the final document before it ships. Returns an empty array when
 * the document is clean; any non-empty result means the caller must NOT stamp
 * `complete`.
 */
export function validateOutput(documentXml: string, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const wellFormedErr = checkWellFormed(documentXml)
  if (wellFormedErr) {
    issues.push({ code: 'malformed_xml', message: `document.xml is not well-formed: ${wellFormedErr}` })
  }

  if (RED_PLACEHOLDER_RE.test(documentXml)) {
    issues.push({ code: 'leftover_placeholder', message: 'a red caption/source placeholder survived past the needs_input gate' })
  }

  const hasSumario = ctx.pretextual.sections.some(s => s.kind === 'sumario')
  if (hasSumario) {
    const entryCount = findSumarioEntries(documentXml).length
    const headingCount = countBodyHeadings(documentXml, ctx.pretextual.bodyStart)
    if (entryCount !== headingCount) {
      issues.push({
        code: 'sumario_mismatch',
        message: `sumário has ${entryCount} entr(ies) but the body has ${headingCount} Heading1-3 paragraph(s)`,
      })
    }
  }

  if (ctx.referencesFlagged && !ctx.referenceRegion) {
    issues.push({ code: 'references_not_located', message: 'references page(s) were flagged but no references region was located in the document' })
  }

  if (ctx.pretextual.bodyStart > 0 && /<w:pgNumType\b[^>]*\bw:start="1"\/>/.test(documentXml)) {
    issues.push({ code: 'page_number_unresolved', message: 'ABNT header page-number start is still the "1" placeholder — paginateSumario did not resolve it' })
  }

  return issues
}
