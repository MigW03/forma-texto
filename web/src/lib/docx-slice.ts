import { unzipSync, zipSync } from 'fflate'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** A top-level body block (paragraph, table, or structured-document-tag) with its plain text. */
export interface DocxBlock {
  index: number
  text: string
}

interface ParsedDocx {
  zip: Record<string, Uint8Array>
  docXml: Document
  body: Element
  /** Ordered `w:p | w:tbl | w:sdt` children of the body — the canonical block list. */
  blocks: Element[]
}

/** Concatenated text of every `<w:t>` descendant of a block. */
function blockText(el: Element): string {
  return Array.from(el.getElementsByTagNameNS(W, 't'))
    .map(t => t.textContent ?? '')
    .join('')
}

/**
 * Unzip + parse a DOCX once and expose the body's block children. This single
 * filter (`p | tbl | sdt`) is the source of truth for block indices shared by
 * word counting (laudas), divider placement, and slicing — so they always agree.
 */
async function parseDocx(file: File): Promise<ParsedDocx | null> {
  const buf = await file.arrayBuffer()
  const zip = unzipSync(new Uint8Array(buf))
  const docXmlStr = new TextDecoder().decode(zip['word/document.xml'])
  const docXml = new DOMParser().parseFromString(docXmlStr, 'application/xml')
  const body = docXml.getElementsByTagNameNS(W, 'body')[0]
  if (!body) return null
  const blocks = Array.from(body.childNodes).filter((n): n is Element => {
    if (n.nodeType !== Node.ELEMENT_NODE) return false
    const name = (n as Element).localName
    return name === 'p' || name === 'tbl' || name === 'sdt'
  })
  return { zip, docXml, body, blocks }
}

/** Ordered body blocks with their trimmed plain text. Empty on a malformed file. */
export async function getDocxBlocks(file: File): Promise<DocxBlock[]> {
  const parsed = await parseDocx(file)
  if (!parsed) return []
  return parsed.blocks.map((el, index) => ({ index, text: blockText(el).trim() }))
}

/**
 * Produce a new DOCX containing only the blocks whose index is in `keepBlockIndices`.
 * Body-level `<w:sectPr>` / bookmarks are not in the block list, so they are preserved.
 * Callers build the keep-set from selected laudas via `laudaBlockSet` (laudas.ts).
 */
export async function sliceDocxByLaudas(file: File, keepBlockIndices: Set<number>): Promise<File> {
  const parsed = await parseDocx(file)
  if (!parsed) return file
  const { zip, docXml, body, blocks } = parsed

  for (let i = blocks.length - 1; i >= 0; i--) {
    if (!keepBlockIndices.has(i)) body.removeChild(blocks[i])
  }

  const newDocXml = new XMLSerializer().serializeToString(docXml)
  const encoder = new TextEncoder()
  const newZip: Record<string, Uint8Array> = {}
  for (const [path, data] of Object.entries(zip)) {
    newZip[path] = path === 'word/document.xml' ? encoder.encode(newDocXml) : data
  }
  const zipped = zipSync(newZip)
  return new File([new Uint8Array(zipped)], file.name, { type: DOCX_MIME })
}
