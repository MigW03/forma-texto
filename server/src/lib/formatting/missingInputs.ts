import { FIGURE_LABEL_RE, SOURCE_LABEL_RE, isImageParagraph } from './captions'
import { CAPTION_STYLE } from './guidelines'
import { getBlocks, isParagraph, replaceBlocks, setParagraphStyle, BLOCK_RE, blockText } from './blocks'
import { escapeXml } from './xmlText'

export type MissingInputKind =
  | 'figure-caption' | 'figure-source'
  | 'table-caption'  | 'table-source'

export interface PendingInput {
  /** Stable unique id per project, e.g. "fig-1-caption", "tbl-2-source". */
  id:         string
  kind:       MissingInputKind
  /** 1-indexed ordinal of the figure or table in document order. */
  ordinal:    number
  /** Absolute block index of the placeholder paragraph in the stored processed docx. */
  insertedAt: number
}

export interface RemovedInput {
  id:        string
  kind:      MissingInputKind
  removedAt: string  // ISO timestamp
}

/** Table caption label: "Tabela 1 —", "Quadro 2:". */
const TABLE_LABEL_RE = /^(?:tabela|quadro)\s+\d+/i

const isTable = (b: string) => /^<w:tbl\b/.test(b)

const hasCaptionStyle = (b: string) => b.includes(`w:val="${CAPTION_STYLE}"`)

function buildPlaceholderXml(text: string): string {
  return (
    `<w:p>` +
    `<w:pPr><w:pStyle w:val="${CAPTION_STYLE}"/></w:pPr>` +
    `<w:r><w:rPr><w:color w:val="FF0000"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` +
    `</w:p>`
  )
}

function buildFinalCaptionXml(text: string): string {
  return (
    `<w:p>` +
    `<w:pPr><w:pStyle w:val="${CAPTION_STYLE}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` +
    `</w:p>`
  )
}

function insertAroundBlocks(
  documentXml: string,
  insertBefore: Map<number, string>,
  insertAfter: Map<number, string>,
): string {
  let i = 0
  return documentXml.replace(BLOCK_RE, m => {
    const cur = i++
    return (insertBefore.get(cur) ?? '') + m + (insertAfter.get(cur) ?? '')
  })
}

interface Insertion {
  id:          string
  kind:        MissingInputKind
  ordinal:     number
  text:        string
  originalIdx: number
  position:    'before' | 'after'
}

/**
 * After `formatCaptions` has run, detect missing figure/table caption and source
 * slots, apply Caption style to existing unstyled neighbors, and insert red
 * placeholder paragraphs for truly absent slots.
 *
 * Returns the modified documentXml and a `pending` array describing each
 * placeholder's position in the new XML — suitable for storage in `pending_inputs`.
 */
export function detectAndInsertPlaceholders(documentXml: string): { xml: string; pending: PendingInput[] } {
  const blocks = getBlocks(documentXml)
  if (!blocks.length) return { xml: documentXml, pending: [] }

  const styleFixMap = new Map<number, string>()
  const insertions: Insertion[] = []
  let figOrdinal = 0
  let tblOrdinal = 0

  blocks.forEach((b, i) => {
    const isImg = isImageParagraph(b)
    const isTbl = isTable(b)
    if (!isImg && !isTbl) return

    if (isImg) figOrdinal++
    else tblOrdinal++

    const ordinal = isImg ? figOrdinal : tblOrdinal
    const anchorKind = isImg ? 'figure' : 'table'
    const labelRE = isImg ? FIGURE_LABEL_RE : TABLE_LABEL_RE

    // ── Caption slot (block immediately before the anchor) ───────────────────
    const prevIsRegularParagraph =
      i > 0 && isParagraph(blocks[i - 1]) && !isImageParagraph(blocks[i - 1])

    if (prevIsRegularParagraph) {
      const prev = blocks[i - 1]
      const styled   = hasCaptionStyle(prev)
      const labelled  = labelRE.test(blockText(prev))
      if (!styled && !labelled) {
        // No label at all — insert a red placeholder above the anchor
        const text = isImg
          ? `Figura ${ordinal} — [inserir legenda]`
          : `Tabela ${ordinal} — [inserir título]`
        insertions.push({ id: `${anchorKind}-${ordinal}-caption`, kind: `${anchorKind}-caption` as MissingInputKind, ordinal, text, originalIdx: i, position: 'before' })
      } else if (labelled && !styled) {
        // Label exists but wasn't styled by formatCaptions (e.g. table neighbor)
        styleFixMap.set(i - 1, setParagraphStyle(prev, CAPTION_STYLE))
      }
      // else: already Caption-styled — nothing to do
    } else if (i === 0) {
      // Anchor is the very first block — nothing can appear above it
      const text = isImg
        ? `Figura ${ordinal} — [inserir legenda]`
        : `Tabela ${ordinal} — [inserir título]`
      insertions.push({ id: `${anchorKind}-${ordinal}-caption`, kind: `${anchorKind}-caption` as MissingInputKind, ordinal, text, originalIdx: i, position: 'before' })
    }
    // else: prev block is another image/table/sdt — conservative, don't insert between stacked elements

    // ── Source slot (block immediately after the anchor) ─────────────────────
    const nextIsRegularParagraph =
      i + 1 < blocks.length && isParagraph(blocks[i + 1]) && !isImageParagraph(blocks[i + 1])

    if (nextIsRegularParagraph) {
      const next = blocks[i + 1]
      const styled   = hasCaptionStyle(next)
      const labelled  = SOURCE_LABEL_RE.test(blockText(next))
      if (!styled && !labelled) {
        insertions.push({ id: `${anchorKind}-${ordinal}-source`, kind: `${anchorKind}-source` as MissingInputKind, ordinal, text: 'Fonte: [inserir fonte]', originalIdx: i, position: 'after' })
      } else if (labelled && !styled) {
        styleFixMap.set(i + 1, setParagraphStyle(next, CAPTION_STYLE))
      }
    } else if (i + 1 >= blocks.length) {
      // Anchor is the very last block — no source possible
      insertions.push({ id: `${anchorKind}-${ordinal}-source`, kind: `${anchorKind}-source` as MissingInputKind, ordinal, text: 'Fonte: [inserir fonte]', originalIdx: i, position: 'after' })
    }
    // else: next block is another image/table/sdt — conservative, skip
  })

  // 1. Apply style-only fixes (no count change, so indices are unaffected)
  let workingXml = styleFixMap.size > 0 ? replaceBlocks(documentXml, styleFixMap) : documentXml

  if (insertions.length === 0) return { xml: workingXml, pending: [] }

  // 2. Sort: by originalIdx ascending; 'before' before 'after' at the same index
  insertions.sort((a, b) => {
    if (a.originalIdx !== b.originalIdx) return a.originalIdx - b.originalIdx
    return a.position === 'before' ? -1 : 1
  })

  // 3. Compute insertedAt for each insertion, tracking the cumulative offset
  //    caused by earlier insertions shifting later block indices.
  const insertBefore = new Map<number, string>()
  const insertAfter  = new Map<number, string>()
  const pending: PendingInput[] = []
  let offset = 0

  for (const ins of insertions) {
    const placeholderXml = buildPlaceholderXml(ins.text)
    let insertedAt: number
    if (ins.position === 'before') {
      insertedAt = ins.originalIdx + offset
      insertBefore.set(ins.originalIdx, placeholderXml)
      offset++
    } else {
      insertedAt = ins.originalIdx + 1 + offset
      insertAfter.set(ins.originalIdx, placeholderXml)
      offset++
    }
    pending.push({ id: ins.id, kind: ins.kind, ordinal: ins.ordinal, insertedAt })
  }

  // 4. Insert placeholder paragraphs into the XML
  workingXml = insertAroundBlocks(workingXml, insertBefore, insertAfter)
  return { xml: workingXml, pending }
}

/**
 * Replace placeholder paragraphs with the user's supplied text (black, Caption
 * style). Only ids present in `fills` are replaced; others are left as-is.
 */
export function fillContent(
  documentXml: string,
  pendingInputs: PendingInput[],
  fills: Record<string, string>,
): string {
  const byIndex = new Map<number, string>()
  for (const input of pendingInputs) {
    const text = fills[input.id]?.trim()
    if (!text) continue
    byIndex.set(input.insertedAt, buildFinalCaptionXml(text))
  }
  return byIndex.size > 0 ? replaceBlocks(documentXml, byIndex) : documentXml
}

/**
 * Replace placeholder paragraphs for the given ids with empty paragraphs
 * (the slot is intentionally removed by the user).
 */
export function removeContent(
  documentXml: string,
  pendingInputs: PendingInput[],
  removalIds: string[],
): string {
  const removalSet = new Set(removalIds)
  const byIndex = new Map<number, string>()
  for (const input of pendingInputs) {
    if (!removalSet.has(input.id)) continue
    byIndex.set(input.insertedAt, '<w:p/>')
  }
  return byIndex.size > 0 ? replaceBlocks(documentXml, byIndex) : documentXml
}
