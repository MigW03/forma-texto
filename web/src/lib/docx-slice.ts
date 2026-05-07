import { unzipSync, zipSync } from 'fflate'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const BLOCKS_PER_PAGE = 40

/**
 * Creates a new DOCX containing only the requested virtual pages.
 * Pages are virtual (no native page concept in DOCX XML); the same
 * 40-non-empty-blocks-per-page heuristic used in extractDocxText() is applied.
 *
 * @param file   The original DOCX/DOC File object.
 * @param pages  1-indexed page numbers to include.
 * @returns      A new File with the same name containing only those pages.
 */
export async function sliceDocx(file: File, pages: number[]): Promise<File> {
  const buf = await file.arrayBuffer()
  const zip = unzipSync(new Uint8Array(buf))

  const decoder = new TextDecoder()
  const encoder = new TextEncoder()

  const docXmlStr = decoder.decode(zip['word/document.xml'])
  const docXml = new DOMParser().parseFromString(docXmlStr, 'application/xml')

  const body = docXml.getElementsByTagNameNS(W, 'body')[0]
  if (!body) return file

  // Collect block-level children (p, tbl, sdt); sectPr is excluded and preserved
  const blockChildren = Array.from(body.childNodes).filter((n): n is Element => {
    if (n.nodeType !== Node.ELEMENT_NODE) return false
    const name = (n as Element).localName
    return name === 'p' || name === 'tbl' || name === 'sdt'
  })

  // Find non-empty paragraph indices (for page boundary calculation)
  const nonEmptyIndices: number[] = []
  for (let i = 0; i < blockChildren.length; i++) {
    const text = Array.from(blockChildren[i].getElementsByTagNameNS(W, 't'))
      .map(t => t.textContent ?? '')
      .join('')
      .trim()
    if (text) nonEmptyIndices.push(i)
  }

  // Determine which block indices to keep for each selected page
  const selectedSet = new Set(pages)
  const keepIndices = new Set<number>()

  for (const page of selectedSet) {
    const start = (page - 1) * BLOCKS_PER_PAGE
    const end = page * BLOCKS_PER_PAGE
    const blockRange = nonEmptyIndices.slice(start, end)
    if (blockRange.length === 0) continue
    // Keep all blocks between first and last non-empty of this page (preserves spacing)
    const min = blockRange[0]
    const max = blockRange[blockRange.length - 1]
    for (let i = min; i <= max; i++) keepIndices.add(i)
  }

  // Remove blocks not in keepIndices
  for (let i = blockChildren.length - 1; i >= 0; i--) {
    if (!keepIndices.has(i)) body.removeChild(blockChildren[i])
  }

  const newDocXml = new XMLSerializer().serializeToString(docXml)

  const newZip: Record<string, Uint8Array> = {}
  for (const [path, data] of Object.entries(zip)) {
    newZip[path] = path === 'word/document.xml' ? encoder.encode(newDocXml) : data
  }

  const zipped = zipSync(newZip)
  const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  return new File([zipped], file.name, { type: mimeType })
}
