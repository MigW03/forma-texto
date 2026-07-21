import { describe, it, expect } from 'vitest'
import { strFromU8, strToU8 } from 'fflate'
import { applyAbntPageNumbering } from './pageNumbering'
import { getBlocks } from './blocks'

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const BODY_SECT_PR = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701"/></w:sectPr>'
const doc = (texts: string[]) =>
  `<w:document><w:body>${texts.map(para).join('')}${BODY_SECT_PR}</w:body></w:document>`

/** Minimal zip `files` map with the two package parts the pass mutates. */
function baseFiles(): Record<string, Uint8Array> {
  return {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
    ),
    'word/_rels/document.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    ),
  }
}

const finalSectPrOf = (xml: string) => xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/)?.[0] ?? ''

describe('applyAbntPageNumbering', () => {
  it('is a no-op when there is no pré-textual region (bodyStart 0)', () => {
    const xml = doc(['1 INTRODUÇÃO', 'Corpo.'])
    const files = baseFiles()
    const result = applyAbntPageNumbering(xml, files, 0, 'Times New Roman')
    expect(result).toBe(xml)
    expect(Object.keys(files)).toHaveLength(2) // untouched
  })

  it('is a no-op when the document has no final sectPr', () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>'
    const files = baseFiles()
    const result = applyAbntPageNumbering(xml, files, 1, 'Times New Roman')
    expect(result).toBe(xml)
  })

  it('splits at bodyStart: front section blanked via empty header/footer, body section numbered', () => {
    const xml = doc(['UNIVERSIDADE X', 'SUMÁRIO', '1 INTRODUÇÃO ... 4', '1 INTRODUÇÃO', 'Corpo.'])
    const files = baseFiles()
    const result = applyAbntPageNumbering(xml, files, 3, 'Arial')

    const blocks = getBlocks(result)
    // The last pré-textual block (index 2) carries a mid-document sectPr that references
    // BOTH an empty header and an empty footer (so no number prints on any of its pages).
    expect(blocks[2]).toContain('<w:sectPr>')
    expect(blocks[2]).toContain('<w:headerReference w:type="default"')
    expect(blocks[2]).toContain('<w:footerReference w:type="default"')

    // The body section (final sectPr) has the numbering header + pgNumType + 2cm header dist.
    const finalSectPr = finalSectPrOf(result)
    expect(finalSectPr).toContain('<w:headerReference w:type="default"')
    expect(finalSectPr).toContain('<w:pgNumType w:fmt="decimal" w:start="1"/>')
    expect(finalSectPr).toContain('w:header="1134"')
  })

  it('CRITICAL real-doc case: strips a pre-existing document-wide PAGE header instead of bailing', () => {
    // The scenario the old `suppressCoverPageNumber` existed for and my first version
    // regressed on: a real upload already carries ONE section with a header reference
    // (an inherited template / Google-Docs header holding a PAGE field), plus cols/docGrid.
    // An earlier version bailed the instant it saw ANY headerReference → numbers stayed
    // on every page. This must instead REPLACE that header and preserve cols/docGrid.
    const realSectPr =
      '<w:sectPr>' +
      '<w:headerReference w:type="default" r:id="rId9"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="708" w:footer="708" w:gutter="0"/>' +
      '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>' +
      '</w:sectPr>'
    const xml =
      '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<w:body>${['UNIVERSIDADE X', 'SUMÁRIO', 'Introdução', 'Corpo do trabalho.'].map(para).join('')}${realSectPr}</w:body></w:document>`
    const files = baseFiles()

    const result = applyAbntPageNumbering(xml, files, 2, 'Times New Roman')
    expect(result).not.toBe(xml) // it must actually DO something

    const finalSectPr = finalSectPrOf(result)
    // The inherited header ref (rId9) is gone; ours replaces it.
    expect(finalSectPr).not.toContain('r:id="rId9"')
    expect(finalSectPr).toContain('<w:headerReference w:type="default"')
    // cols/docGrid survive (we modify the sectPr in place, never rebuild it).
    expect(finalSectPr).toContain('<w:cols w:space="708"/>')
    expect(finalSectPr).toContain('<w:docGrid w:linePitch="360"/>')
    // pgNumType lands after pgMar (schema order slot 10 after slot 6), before cols/docGrid.
    expect(finalSectPr).toMatch(/<w:pgMar\b[^>]*\/><w:pgNumType\b[^>]*\/>/)
    // Front section blanks the pré-textual pages against that document-wide header.
    const blocks = getBlocks(result)
    expect(blocks[1]).toContain('<w:footerReference w:type="default"')
  })

  it('registers a number-only header + empty header + empty footer with CT + rels entries', () => {
    const xml = doc(['SUMÁRIO', '1 INTRODUÇÃO', 'Corpo.'])
    const files = baseFiles()
    applyAbntPageNumbering(xml, files, 2, 'Times New Roman')

    // header1 = the number header (registered first).
    const headerXml = strFromU8(files['word/header1.xml'])
    expect(headerXml).toContain('<w:hdr')
    expect(headerXml).toContain('PAGE')
    expect(headerXml).toContain('w:jc w:val="right"')
    expect(headerXml).toContain('Times New Roman')
    expect(headerXml).toContain('w:val="20"') // 10pt page-number size (abnt.md spec)
    // header2 = empty header, footer1 = empty footer.
    expect(strFromU8(files['word/header2.xml'])).toContain('<w:hdr')
    expect(strFromU8(files['word/header2.xml'])).not.toContain('PAGE')
    expect(strFromU8(files['word/footer1.xml'])).toContain('<w:ftr')

    const ct = strFromU8(files['[Content_Types].xml'])
    expect(ct).toContain('/word/header1.xml')
    expect(ct).toContain('wordprocessingml.header+xml')
    expect(ct).toContain('/word/footer1.xml')
    expect(ct).toContain('wordprocessingml.footer+xml')

    const rels = strFromU8(files['word/_rels/document.xml.rels'])
    expect(rels).toContain('Target="header1.xml"')
    expect(rels).toContain('Target="footer1.xml"')
    expect(rels).toContain('relationships/footer')
  })

  it('picks the next free part index and rId when others already exist', () => {
    const xml = doc(['SUMÁRIO', '1 INTRODUÇÃO', 'Corpo.'])
    const files = baseFiles()
    files['word/header1.xml'] = strToU8('<w:hdr/>')
    files['word/_rels/document.xml.rels'] = strToU8(
      strFromU8(files['word/_rels/document.xml.rels']).replace(
        '</Relationships>',
        '<Relationship Id="rId5" Type="x" Target="header1.xml"/></Relationships>',
      ),
    )
    applyAbntPageNumbering(xml, files, 2, 'Times New Roman')
    // Existing header1 → number header becomes header2, empty header header3, empty footer footer1.
    expect(files['word/header2.xml']).toBeDefined()
    expect(files['word/header3.xml']).toBeDefined()
    expect(files['word/footer1.xml']).toBeDefined()
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('Id="rId6"')
  })

  it('is idempotent — a second call is a no-op (a section break already sits at the boundary)', () => {
    const xml = doc(['SUMÁRIO', '1 INTRODUÇÃO', 'Corpo.'])
    const files = baseFiles()
    const once = applyAbntPageNumbering(xml, files, 2, 'Times New Roman')
    const fileCountAfterFirst = Object.keys(files).length
    const twice = applyAbntPageNumbering(once, files, 2, 'Times New Roman')
    expect(twice).toBe(once)
    expect(Object.keys(files)).toHaveLength(fileCountAfterFirst)
  })

  it('declares the xmlns:r namespace on the root <w:document> element when missing — required for r:id', () => {
    const xml = doc(['SUMÁRIO', '1 INTRODUÇÃO', 'Corpo.'])
    const files = baseFiles()
    const result = applyAbntPageNumbering(xml, files, 2, 'Times New Roman')
    const rootTag = result.match(/<w:document\b[^>]*>/)?.[0] ?? ''
    expect(rootTag).toContain('xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
    expect(result).toContain('r:id="rId2"')
  })

  it('does not duplicate xmlns:r when the root element already declares it', () => {
    const withR = doc(['SUMÁRIO', '1 INTRODUÇÃO', 'Corpo.']).replace(
      '<w:document>',
      '<w:document xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    )
    const files = baseFiles()
    const result = applyAbntPageNumbering(withR, files, 2, 'Times New Roman')
    expect((result.match(/xmlns:r=/g) ?? []).length).toBe(1)
  })

  it('falls back to a new empty paragraph when the last pré-textual block is not a paragraph', () => {
    const xml =
      `<w:document><w:body>${para('SUMÁRIO')}<w:tbl><w:tr><w:tc>${para('cell')}</w:tc></w:tr></w:tbl>${para('1 INTRODUÇÃO')}${para('Corpo.')}${BODY_SECT_PR}</w:body></w:document>`
    const files = baseFiles()
    // bodyStart = 2 -> last pré-textual block (index 1) is the <w:tbl>, not a paragraph.
    const result = applyAbntPageNumbering(xml, files, 2, 'Times New Roman')
    const blocks = getBlocks(result)
    expect(blocks).toHaveLength(5) // table + new empty sectPr-carrying paragraph, then intro + corpo
    expect(blocks[1]).toContain('<w:tbl>')
    expect(blocks[2]).toContain('<w:sectPr>')
    expect(blocks[2]).toContain('<w:headerReference w:type="default"') // empty header ref
  })
})
