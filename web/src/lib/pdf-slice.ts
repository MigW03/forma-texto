import { PDFDocument } from 'pdf-lib'

/**
 * Creates a new PDF containing only the requested pages.
 * @param file    The original PDF File object.
 * @param pages   1-indexed page numbers to include, in any order.
 * @returns       A new File with the same name containing only those pages.
 */
export async function slicePdf(file: File, pages: number[]): Promise<File> {
  const bytes = await file.arrayBuffer()
  const srcDoc = await PDFDocument.load(bytes)
  const total = srcDoc.getPageCount()

  // Convert to 0-indexed, deduplicate, sort, and clamp to valid range
  const indices = Array.from(new Set(pages))
    .map(p => p - 1)
    .filter(i => i >= 0 && i < total)
    .sort((a, b) => a - b)

  const newDoc = await PDFDocument.create()
  const copied = await newDoc.copyPages(srcDoc, indices)
  copied.forEach(page => newDoc.addPage(page))

  const pdfBytes = await newDoc.save()
  return new File([new Uint8Array(pdfBytes)], file.name, { type: 'application/pdf' })
}
