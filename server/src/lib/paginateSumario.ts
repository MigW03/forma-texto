/**
 * Sumário pagination — the LAST content transform of the pipeline.
 *
 * Renders the (otherwise final) document through the real PDF export path
 * (LibreOffice headless, the same converter the "Baixar PDF" feature uses), reads
 * which physical page each heading landed on, and stamps those numbers into the
 * sumário's TOC entries. It MUST run after every other pass — any later change to
 * the document could shift pages and stale the numbers. Adding the short number
 * runs does not reflow pages: each entry is a single line with a right tab at the
 * margin, so the number occupies reserved space.
 *
 * Non-fatal by contract (mirrors `exportPdfBeside`): a missing/broken LibreOffice
 * or an unparseable PDF logs and returns the document unchanged — the sumário then
 * simply keeps blank page numbers, and the job still completes.
 */
import { zipDocx, findSumarioEntries, applySumarioPageNumbers } from './formatting'
import { docxToPdf } from './docxToPdf'
import { pdfPageTexts } from './pdfPageTexts'

export async function paginateSumario(
  files: Record<string, Uint8Array>,
  documentXml: string,
  stylesXml: string | null,
  projectId: string,
): Promise<string> {
  try {
    if (findSumarioEntries(documentXml).length === 0) return documentXml

    const docx = zipDocx(files, { documentXml, stylesXml })
    const pdf = await docxToPdf(Buffer.from(docx))
    const pages = await pdfPageTexts(pdf)
    const { documentXml: xml, assigned, total } = applySumarioPageNumbers(documentXml, pages)
    console.log(`[paginateSumario] ${projectId} numbered ${assigned}/${total} sumário entr(ies) (render: ${pages.length} page(s))`)
    return xml
  } catch (err) {
    console.error(`[paginateSumario] failed for ${projectId} (non-fatal, sumário page numbers stay blank):`, err)
    return documentXml
  }
}
