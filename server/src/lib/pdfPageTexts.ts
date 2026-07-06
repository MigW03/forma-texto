/**
 * Per-page text extraction from a PDF buffer, via `pdf-parse` (pdf.js under the
 * hood — pure JS, no system binary). Used by the sumário pagination pass to learn
 * which physical page each heading landed on in the final LibreOffice render.
 */
import pdfParse from 'pdf-parse'

type TextItem = { str: string }
type PageData = { getTextContent(): Promise<{ items: TextItem[] }> }

/** Extract each page's visible text, in page order (index 0 = page 1). */
export async function pdfPageTexts(pdf: Buffer): Promise<string[]> {
  const pages: string[] = []
  await pdfParse(pdf, {
    // pdf-parse renders pages sequentially and awaits each callback, so push order
    // is page order. Items are joined with spaces — the pagination matcher
    // normalizes whitespace anyway.
    pagerender: async (pageData: PageData) => {
      const content = await pageData.getTextContent()
      const text = content.items.map(it => it.str).join(' ')
      pages.push(text)
      return text
    },
  })
  return pages
}
