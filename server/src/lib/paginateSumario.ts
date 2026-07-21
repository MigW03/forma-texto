/**
 * Sumário pagination + ABNT header page-number resolution — the LAST content
 * transform of the pipeline.
 *
 * Renders the (otherwise final) document through the real PDF export path
 * (LibreOffice headless, the same converter the "Baixar PDF" feature uses), reads
 * which physical page each heading landed on, and:
 *  1. Stamps those numbers into the sumário's TOC entries.
 *  2. Resolves the placeholder `<w:pgNumType w:start="1"/>` `applyAbntPageNumbering`
 *     (`pageNumbering.ts`) stamped onto the body section's header, with the real
 *     display start value — DOCX carries no page metadata, so this is the only
 *     point in the pipeline that knows it.
 * Both use the same ABNT display offset (capa excluded from the count — see
 * `sumarioPagination.ts`), so the sumário and the printed header always agree.
 *
 * MUST run after every other pass — any later change to the document could shift
 * pages and stale the numbers. Adding the short number runs does not reflow pages:
 * each sumário entry is a single line with a right tab at the margin (reserved
 * space), and the header's placeholder is replaced digit-for-digit.
 *
 * Non-fatal by contract (mirrors `exportPdfBeside`): a missing/broken LibreOffice
 * or an unparseable PDF logs and returns the document unchanged — numbers that
 * depend on the render (sumário entries, the header start) simply stay
 * blank/placeholder, and the job still completes.
 */
import {
  zipDocx,
  findSumarioEntries,
  applySumarioPageNumbers,
  findBodyStartPage,
  abntCapaOffset,
  stampAbntPageNumberStart,
  type PretextualSection,
} from './formatting'
import { docxToPdf } from './docxToPdf'
import { pdfPageTexts } from './pdfPageTexts'

export interface PaginateSumarioContext {
  sections: PretextualSection[]
  bodyStart: number
}

export async function paginateSumario(
  files: Record<string, Uint8Array>,
  documentXml: string,
  stylesXml: string | null,
  projectId: string,
  pretextual: PaginateSumarioContext,
): Promise<string> {
  const hasSumario = findSumarioEntries(documentXml).length > 0
  const needsHeaderStart = pretextual.bodyStart > 0 && /<w:pgNumType\b[^>]*w:start="1"\/>/.test(documentXml)
  if (!hasSumario && !needsHeaderStart) return documentXml

  try {
    const docx = zipDocx(files, { documentXml, stylesXml })
    const pdf = await docxToPdf(Buffer.from(docx))
    const pages = await pdfPageTexts(pdf)
    const offset = abntCapaOffset(pretextual.sections)

    let xml = documentXml
    if (hasSumario) {
      const result = applySumarioPageNumbers(xml, pages, offset)
      xml = result.documentXml
      console.log(`[paginateSumario] ${projectId} numbered ${result.assigned}/${result.total} sumário entr(ies) (render: ${pages.length} page(s))`)
    }
    if (needsHeaderStart) {
      const physical = findBodyStartPage(xml, pretextual.bodyStart, pages)
      if (physical !== null) {
        xml = stampAbntPageNumberStart(xml, physical - offset)
        console.log(`[paginateSumario] ${projectId} ABNT header page number starts at ${Math.max(physical - offset, 1)} (physical page ${physical}, offset ${offset})`)
      } else {
        console.warn(`[paginateSumario] ${projectId} could not locate the body-start page in the render — header page number stays at the placeholder`)
      }
    }
    return xml
  } catch (err) {
    console.error(`[paginateSumario] failed for ${projectId} (non-fatal, page numbers stay blank/placeholder):`, err)
    return documentXml
  }
}
