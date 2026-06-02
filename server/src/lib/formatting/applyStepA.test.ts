import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { unzipDocx, zipDocx } from './docxZip'
import { applyStepA } from './applyStepA'

// Minimal in-memory "docx": just the parts we touch + a sibling we must not lose.
function makeDocx(documentXml: string, stylesXml?: string) {
  const files: Record<string, Uint8Array> = {
    'word/document.xml': strToU8(documentXml),
    '[Content_Types].xml': strToU8('<Types/>'),
  }
  if (stylesXml) files['word/styles.xml'] = strToU8(stylesXml)
  return Buffer.from(zipSync(files))
}

const BROKEN_DOC =
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
  '<w:p><w:pPr><w:spacing w:line="240"/></w:pPr>' +
  '<w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="28"/><w:b/></w:rPr><w:t>Título</w:t></w:r></w:p>' +
  '<w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
  '</w:body></w:document>'

describe('docxZip + applyStepA round-trip', () => {
  it('unzips, applies Step A, re-zips, and re-opens cleanly', () => {
    const buf = makeDocx(BROKEN_DOC, '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:styles>')

    const { files, documentXml, stylesXml } = unzipDocx(buf)
    const out = applyStepA({ documentXml, stylesXml, guideline: 'abnt' })
    const rezipped = zipDocx(files, out)

    // re-open
    const reopened = unzipDocx(rezipped)

    // overrides stripped, semantics + text kept
    expect(reopened.documentXml).not.toContain('<w:rFonts')
    expect(reopened.documentXml).not.toContain('<w:sz ')
    expect(reopened.documentXml).not.toContain('<w:spacing')
    expect(reopened.documentXml).toContain('<w:b/>')
    expect(reopened.documentXml).toContain('<w:t>Título</w:t>')

    // margins fixed
    expect(reopened.documentXml).toContain('w:top="1701"')

    // styles rewritten
    expect(reopened.stylesXml).toContain('w:ascii="Times New Roman"')
    expect(reopened.stylesXml).toContain('w:styleId="Heading1"')

    // untouched sibling part survived
    expect(reopened.files['[Content_Types].xml']).toBeDefined()
  })

  it('throws on a zip without word/document.xml', () => {
    const notDocx = Buffer.from(zipSync({ 'foo.txt': strToU8('hi') }))
    expect(() => unzipDocx(notDocx)).toThrow(/document\.xml/)
  })

  it('handles a docx with no styles.xml (scaffold)', () => {
    const buf = makeDocx(BROKEN_DOC) // no styles part
    const { files, documentXml, stylesXml } = unzipDocx(buf)
    expect(stylesXml).toBeNull()
    const out = applyStepA({ documentXml, stylesXml, guideline: 'abnt' })
    expect(out.stylesXml).toContain('w:styleId="Normal"')
    const rezipped = zipDocx(files, out)
    expect(unzipDocx(rezipped).stylesXml).toContain('Times New Roman')
  })
})
