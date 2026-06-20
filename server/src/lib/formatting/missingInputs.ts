import { randomUUID } from 'crypto'
import { CAPTION_STYLE } from './guidelines'
import { getBlocks, isParagraph, blockText, replaceBlocks } from './blocks'
import { isImageParagraph, FIGURE_LABEL_RE, SOURCE_LABEL_RE } from './captions'
import { escapeXml } from './xmlText'
import { normalizePlainText } from './applyPunctNorm'

export type MissingInputKind =
  | 'figure_caption'
  | 'figure_source'
  | 'table_caption'
  | 'table_source'

export interface PendingInput {
  id: string
  kind: MissingInputKind
  ordinal: number
  /** Absolute block index in the stored processed DOCX (post-insertion). */
  insertedAt: number
}

/** Table caption label at start of line: "Tabela 1 — ", "Quadro 2: ", etc. */
const TABLE_LABEL_RE = /^(?:tabela|quadro)\s+\d+(?:[.\-–—]\d+)*\s*[-–—:]/i

const isTableBlock = (b: string) => /^<w:tbl\b/.test(b)

const isImageOrTable = (b: string) => isImageParagraph(b) || isTableBlock(b)

const hasCaptionStyle = (b: string) => /<w:pStyle\b[^>]*w:val="Caption"/.test(b)

const PLACEHOLDER_TEXT: Record<MissingInputKind, string> = {
  figure_caption: '[inserir legenda da figura]',
  figure_source: '[inserir fonte]',
  table_caption: '[inserir legenda da tabela]',
  table_source: '[inserir fonte]',
}

const isSourceKind = (kind: MissingInputKind) => kind === 'figure_source' || kind === 'table_source'

// Source lines ("Fonte: …") get 1.5 line spacing; captions stay single. 360 twentieths
// of a point = 1.5× (single = 240). Placed after <w:pStyle> per the OOXML pPr order.
const SOURCE_SPACING = '<w:spacing w:line="360" w:lineRule="auto"/>'

function buildPlaceholderXml(kind: MissingInputKind): string {
  const spacing = isSourceKind(kind) ? SOURCE_SPACING : ''
  return `<w:p><w:pPr><w:pStyle w:val="${CAPTION_STYLE}"/>${spacing}</w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>${PLACEHOLDER_TEXT[kind]}</w:t></w:r></w:p>`
}

function buildCaptionXml(text: string, kind: MissingInputKind): string {
  const spacing = isSourceKind(kind) ? SOURCE_SPACING : ''
  return `<w:p><w:pPr><w:pStyle w:val="${CAPTION_STYLE}"/>${spacing}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

/** ABNT label word for each caption kind. */
const CAPTION_LABEL: Record<MissingInputKind, string> = {
  figure_caption: 'Figura',
  table_caption: 'Tabela',
  figure_source: 'Fonte',
  table_source: 'Fonte',
}

// A label the user may have typed at the start of a caption — any casing, optional
// number (incl. sub-numbers like "3.1") and trailing separator. Stripped so we can
// rebuild it canonically with the correct word, number, and em-dash.
const LEADING_CAPTION_LABEL = /^\s*(?:figura|tabela|quadro|gráfico|grafico|imagem|fig)\.?\s*\d*(?:[.\-–—]\d+)*\s*[-–—:.]*\s*/i
// A "Fonte" prefix the user may have typed, any casing + optional separator.
const LEADING_SOURCE_LABEL = /^\s*fonte\s*[:\-–—]?\s*/i

/** Uppercase the first letter (Unicode-aware), leave the rest untouched. */
function capitalizeFirst(s: string): string {
  return s.replace(/^(\p{L})/u, (_m, c: string) => c.toUpperCase())
}

/**
 * Clean a user-typed caption/source before it goes into the document. Applies the
 * deterministic text rules (`normalizePlainText` — spacing, smart quotes, em dash,
 * etc.), then rebuilds the ABNT label canonically:
 *  - captions → `Figura N — Descrição` / `Tabela N — Descrição`, with **N forced to the
 *    figure/table's true sequential ordinal** (so a user who retypes "3" for the 4th
 *    figure gets "Figura 4"); the description's first letter is capitalised.
 *  - sources → `Fonte: …`, first letter capitalised.
 * The label the user may have typed (any casing/number) is stripped and replaced.
 */
export function normalizeInputText(rawText: string, kind: MissingInputKind, ordinal: number): string {
  const text = normalizePlainText(rawText.trim())
  if (kind === 'figure_source' || kind === 'table_source') {
    const rest = capitalizeFirst(text.replace(LEADING_SOURCE_LABEL, '').trim())
    return rest ? `Fonte: ${rest}` : 'Fonte:'
  }
  const label = CAPTION_LABEL[kind]
  const rest = capitalizeFirst(text.replace(LEADING_CAPTION_LABEL, '').trim())
  return rest ? `${label} ${ordinal} — ${rest}` : `${label} ${ordinal}`
}

interface InsertEntry { kind: MissingInputKind; ordinal: number }

/** True when the slot at `idx` is already occupied by a caption or label paragraph. */
function captionOccupied(blocks: string[], idx: number, labelRe: RegExp): boolean {
  if (idx < 0 || idx >= blocks.length) return false
  const b = blocks[idx]
  if (!isParagraph(b) || isImageOrTable(b)) return false
  return hasCaptionStyle(b) || labelRe.test(blockText(b))
}

/** True when the slot at `idx` has a source ("Fonte: …") paragraph. */
function sourceOccupied(blocks: string[], idx: number): boolean {
  if (idx < 0 || idx >= blocks.length) return false
  const b = blocks[idx]
  if (!isParagraph(b) || isImageOrTable(b)) return false
  return SOURCE_LABEL_RE.test(blockText(b))
}

/**
 * Walk the processed document looking for images and tables that are missing
 * required ABNT caption or source lines. For each gap, insert a pre-formatted
 * red placeholder paragraph (Caption style + red text) and record its location.
 *
 * Stacked images/tables (adjacent without a paragraph between them) are skipped
 * conservatively — no placeholder is inserted between them.
 *
 * Returns the modified documentXml and the list of pending inputs whose
 * `insertedAt` reflects the block index in the returned XML.
 */
export function detectAndInsertPlaceholders(documentXml: string): { xml: string; pending: PendingInput[] } {
  const blocks = getBlocks(documentXml)
  if (blocks.length === 0) return { xml: documentXml, pending: [] }

  const insertBefore = new Map<number, InsertEntry>()
  const insertAfter = new Map<number, InsertEntry>()
  let figureOrdinal = 0
  let tableOrdinal = 0

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]

    if (isImageParagraph(b)) {
      figureOrdinal++
      const ord = figureOrdinal
      const prevIsImageOrTable = i > 0 && isImageOrTable(blocks[i - 1])
      const nextIsImageOrTable = i + 1 < blocks.length && isImageOrTable(blocks[i + 1])

      if (!captionOccupied(blocks, i - 1, FIGURE_LABEL_RE) && !prevIsImageOrTable) {
        insertBefore.set(i, { kind: 'figure_caption', ordinal: ord })
      }
      if (!sourceOccupied(blocks, i + 1) && !nextIsImageOrTable) {
        insertAfter.set(i, { kind: 'figure_source', ordinal: ord })
      }
    } else if (isTableBlock(b)) {
      tableOrdinal++
      const ord = tableOrdinal
      const prevIsImageOrTable = i > 0 && isImageOrTable(blocks[i - 1])
      const nextIsImageOrTable = i + 1 < blocks.length && isImageOrTable(blocks[i + 1])

      if (!captionOccupied(blocks, i - 1, TABLE_LABEL_RE) && !prevIsImageOrTable) {
        insertBefore.set(i, { kind: 'table_caption', ordinal: ord })
      }
      if (!sourceOccupied(blocks, i + 1) && !nextIsImageOrTable) {
        insertAfter.set(i, { kind: 'table_source', ordinal: ord })
      }
    }
  }

  if (insertBefore.size === 0 && insertAfter.size === 0) {
    return { xml: documentXml, pending: [] }
  }

  // Build the modified document and track each placeholder's output index.
  const pending: PendingInput[] = []
  const byIndex = new Map<number, string>()
  let outputIdx = 0

  for (let i = 0; i < blocks.length; i++) {
    const parts: string[] = []
    const before = insertBefore.get(i)
    if (before) {
      pending.push({ id: randomUUID(), kind: before.kind, ordinal: before.ordinal, insertedAt: outputIdx })
      parts.push(buildPlaceholderXml(before.kind))
      outputIdx++
    }

    parts.push(blocks[i])
    outputIdx++

    const after = insertAfter.get(i)
    if (after) {
      pending.push({ id: randomUUID(), kind: after.kind, ordinal: after.ordinal, insertedAt: outputIdx })
      parts.push(buildPlaceholderXml(after.kind))
      outputIdx++
    }

    if (parts.length > 1) byIndex.set(i, parts.join(''))
  }

  return { xml: replaceBlocks(documentXml, byIndex), pending }
}

/**
 * Apply all fills and removals in a single pass over the stored processed DOCX.
 * fills → replace each placeholder with a properly-styled Caption paragraph.
 * removals → delete the placeholder block entirely.
 * pending is used only to look up insertedAt for each id.
 */
export function finalizeInputs(
  documentXml: string,
  fills: { id: string; text: string }[],
  removals: string[],
  pending: PendingInput[],
): string {
  if (fills.length === 0 && removals.length === 0) return documentXml

  const byId = new Map(pending.map(p => [p.id, p]))
  const byIndex = new Map<number, string>()

  for (const fill of fills) {
    const p = byId.get(fill.id)
    if (!p) continue
    byIndex.set(p.insertedAt, buildCaptionXml(normalizeInputText(fill.text, p.kind, p.ordinal), p.kind))
  }

  for (const id of removals) {
    const p = byId.get(id)
    if (!p) continue
    byIndex.set(p.insertedAt, '')
  }

  if (byIndex.size === 0) return documentXml
  return replaceBlocks(documentXml, byIndex)
}
