import { unzipSync, zipSync } from 'fflate'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const BLOCKS_PER_PAGE = 40

/**
 * Creates a new DOCX containing only the requested pages.
 *
 * Page detection strategy:
 * 1. sectPr-based — each <w:sectPr> inside <w:pPr> marks a section/page boundary.
 *    Acrobat-converted DOCXs and well-structured documents use this.
 * 2. 40-block heuristic — fallback for simple DOCXs with no section breaks.
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

  const blockChildren = Array.from(body.childNodes).filter((n): n is Element => {
    if (n.nodeType !== Node.ELEMENT_NODE) return false
    const name = (n as Element).localName
    return name === 'p' || name === 'tbl' || name === 'sdt'
  })

  // Detect sectPr-based page boundaries (inline sectPr inside pPr)
  const sectionEndIndices: number[] = []
  for (let i = 0; i < blockChildren.length; i++) {
    const el = blockChildren[i]
    if (el.localName !== 'p') continue
    const pPr = el.getElementsByTagNameNS(W, 'pPr')[0]
    if (pPr && pPr.getElementsByTagNameNS(W, 'sectPr').length > 0) {
      sectionEndIndices.push(i)
    }
  }

  const selectedSet = new Set(pages)
  const keepIndices = new Set<number>()

  if (sectionEndIndices.length > 1) {
    // sectPr-based slicing: each sectionEndIndex marks the last block of that page.
    // Page 1: blocks 0..sectionEndIndices[0]
    // Page 2: blocks sectionEndIndices[0]+1..sectionEndIndices[1]
    // ...
    // Last page: blocks after last sectionEndIndex to end of document
    let start = 0
    const totalPages = sectionEndIndices.length + 1
    for (let page = 1; page <= totalPages; page++) {
      const end = page <= sectionEndIndices.length
        ? sectionEndIndices[page - 1]
        : blockChildren.length - 1

      if (selectedSet.has(page)) {
        for (let i = start; i <= end; i++) keepIndices.add(i)
      }
      start = end + 1
    }
  } else {
    // Fallback: 40-non-empty-blocks-per-page heuristic
    const nonEmptyIndices: number[] = []
    for (let i = 0; i < blockChildren.length; i++) {
      const text = Array.from(blockChildren[i].getElementsByTagNameNS(W, 't'))
        .map(t => t.textContent ?? '')
        .join('')
        .trim()
      if (text) nonEmptyIndices.push(i)
    }

    for (const page of selectedSet) {
      const s = (page - 1) * BLOCKS_PER_PAGE
      const e = page * BLOCKS_PER_PAGE
      const blockRange = nonEmptyIndices.slice(s, e)
      if (blockRange.length === 0) continue
      const min = blockRange[0]
      const max = blockRange[blockRange.length - 1]
      for (let i = min; i <= max; i++) keepIndices.add(i)
    }
  }

  // Remove blocks not in keepIndices (reverse order to preserve indices)
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
