import { describe, it, expect } from 'vitest'
import {
  getBlocks,
  blockText,
  isParagraph,
  blockDescriptor,
  setParagraphStyle,
  clearHeadingStyle,
  replaceBlocks,
} from './blocks'

const DOC = `<w:document><w:body>` +
  `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>MEU TÍTULO</w:t></w:r></w:p>` +
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1 INTRODUÇÃO</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Texto normal do corpo.</w:t></w:r></w:p>` +
  `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>célula</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
  `<w:p/>` +
  `</w:body></w:document>`

describe('getBlocks', () => {
  it('returns top-level blocks in order: 3 paragraphs, 1 table, 1 empty paragraph', () => {
    const blocks = getBlocks(DOC)
    expect(blocks).toHaveLength(5)
    expect(isParagraph(blocks[0])).toBe(true)
    expect(blocks[3].startsWith('<w:tbl')).toBe(true)
    expect(isParagraph(blocks[4])).toBe(true) // self-closing <w:p/>
  })

  it('does not truncate a <w:sdt> nested inside another <w:sdt>', () => {
    // Real bug, found on an actual thesis: a single non-greedy regex (the previous
    // implementation) closes at the FIRST </w:sdt> it finds — the INNER one — leaving
    // the outer sdt's remaining content (here, the trailing paragraph and its own
    // closing tags) outside of any recognized block. `replaceBlocks` then left that
    // orphaned tail's dangling closing tags sitting in the output verbatim, wherever
    // they happened to fall relative to whatever replaced the (truncated) outer block —
    // genuinely invalid XML that LibreOffice refused to even open.
    const nested =
      '<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:r><w:t>outer text before</w:t></w:r></w:p>' +
      '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:r><w:t>inner text</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>' +
      '<w:p><w:r><w:t>outer text after</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>'
    const doc = `<w:document><w:body>${nested}<w:p><w:r><w:t>next paragraph</w:t></w:r></w:p></w:body></w:document>`
    const blocks = getBlocks(doc)
    expect(blocks).toHaveLength(2) // the whole nested sdt as ONE block, then the next paragraph
    expect(blocks[0]).toBe(nested) // captured whole, not truncated at the inner </w:sdt>
    expect(blocks[0]).toContain('outer text after') // survived the inner sdt's close tag
    expect(blockText(blocks[1])).toBe('next paragraph') // correctly indexed after, not corrupted
  })

  it('does not truncate a <w:tbl> nested inside another <w:tbl> (a table inside a table cell)', () => {
    const inner = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const outer = `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>before</w:t></w:r></w:p>${inner}<w:p><w:r><w:t>after</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    const doc = `<w:document><w:body>${outer}<w:p><w:r><w:t>next paragraph</w:t></w:r></w:p></w:body></w:document>`
    const blocks = getBlocks(doc)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe(outer)
    expect(blocks[0]).toContain('after')
    expect(blockText(blocks[1])).toBe('next paragraph')
  })
})

describe('blockText', () => {
  it('concatenates run text, trimmed', () => {
    expect(blockText(getBlocks(DOC)[1])).toBe('1 INTRODUÇÃO')
    expect(blockText(getBlocks(DOC)[4])).toBe('') // empty paragraph
  })

  it('decodes XML entities so a literal "&" round-trips correctly', () => {
    // Word (and any valid XML writer) always escapes "&" as "&amp;" in <w:t> text —
    // a paragraph titled "CESAR & LOIS" is stored as "CESAR &amp; LOIS" in the XML.
    // Without decoding, downstream re-escaping (e.g. sumário TOC entries) doubles it
    // to a literal "&amp;" in the output.
    const doc = `<w:document><w:body><w:p><w:r><w:t>CESAR &amp; LOIS</w:t></w:r></w:p></w:body></w:document>`
    expect(blockText(getBlocks(doc)[0])).toBe('CESAR & LOIS')
  })

  it('does not mistake the <w:tabs> tab-stop container for a <w:t> run', () => {
    // `<w:tabs>` and `<w:tab w:val=…/>` both start with the literal 4 chars `<w:t`, so a
    // naive /<w:t[^>]*>/ opens on the tab-stop container and swallows everything up to the
    // next real </w:t> as if it were paragraph text. Right-tab stops appear on nearly every
    // sumário entry (including the ones `buildTocEntry` generates), so this corrupts text
    // extraction wherever blockText runs over one.
    const doc =
      `<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="8306"/></w:tabs></w:pPr>` +
      `<w:r><w:t>INTRODUÇÃO</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>12</w:t></w:r></w:p></w:body></w:document>`
    expect(blockText(getBlocks(doc)[0])).toBe('INTRODUÇÃO 12')
  })

  it('keeps a field code out of the extracted text', () => {
    // A Google Docs auto-TOC stores its field code in <w:instrText>. The tab-stop bug let
    // that leak into the "extracted text" of a real document.
    const doc =
      `<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="8306"/></w:tabs></w:pPr>` +
      `<w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>` +
      `<w:r><w:t>SUMÁRIO</w:t></w:r></w:p></w:body></w:document>`
    expect(blockText(getBlocks(doc)[0])).toBe('SUMÁRIO')
  })

  it('still reads a <w:t> that carries attributes', () => {
    const doc = `<w:document><w:body><w:p><w:r><w:t xml:space="preserve">  spaced  </w:t></w:r></w:p></w:body></w:document>`
    expect(blockText(getBlocks(doc)[0])).toBe('spaced')
  })
})

describe('blockDescriptor', () => {
  it('captures style for a styled paragraph', () => {
    const d = blockDescriptor(getBlocks(DOC)[0], 0)
    expect(d).toMatchObject({ i: 0, style: 'Title', text: 'MEU TÍTULO', bold: false })
  })
  it('detects bold and defaults style to Normal', () => {
    const d = blockDescriptor(getBlocks(DOC)[1], 1)
    expect(d).toMatchObject({ i: 1, style: 'Normal', bold: true })
    expect(d.len).toBe('1 INTRODUÇÃO'.length)
  })
  it('truncates text to 200 chars but reports full length', () => {
    const long = `<w:p><w:r><w:t>${'a'.repeat(500)}</w:t></w:r></w:p>`
    const d = blockDescriptor(long, 7)
    expect(d.text).toHaveLength(200)
    expect(d.len).toBe(500)
  })
})

describe('setParagraphStyle', () => {
  it('replaces an existing pStyle', () => {
    const out = setParagraphStyle(getBlocks(DOC)[0], 'Heading1')
    expect(out).toContain('<w:pStyle w:val="Heading1"/>')
    expect(out).not.toContain('w:val="Title"')
  })
  it('inserts pPr + pStyle when absent', () => {
    const out = setParagraphStyle(getBlocks(DOC)[1], 'Heading1')
    expect(out).toContain('<w:pPr><w:pStyle w:val="Heading1"/>')
    expect(out).toContain('1 INTRODUÇÃO') // text preserved
  })
})

describe('clearHeadingStyle', () => {
  it('removes the pStyle element', () => {
    const out = clearHeadingStyle(getBlocks(DOC)[0])
    expect(out).not.toContain('w:pStyle')
  })
})

describe('replaceBlocks', () => {
  it('splices only the indexed blocks, leaving others byte-for-byte', () => {
    const byIndex = new Map([[1, setParagraphStyle(getBlocks(DOC)[1], 'Heading1')]])
    const out = replaceBlocks(DOC, byIndex)
    expect(out).toContain('<w:pStyle w:val="Heading1"/>')
    // untouched blocks survive verbatim
    expect(out).toContain('<w:pStyle w:val="Title"/>')
    expect(out).toContain('Texto normal do corpo.')
    // round-trips back to the same block count
    expect(getBlocks(out)).toHaveLength(5)
  })

  it('round-trips a nested <w:sdt> untouched and correctly replaces the block after it', () => {
    // Same shape as the real bug: replacing a LATER block (by index) must not corrupt a
    // nested sdt that comes before it, and the nested sdt itself must not be miscounted
    // as two blocks (which would throw off every subsequent index).
    const nested =
      '<w:sdt><w:sdtPr><w:tag w:val="outer"/></w:sdtPr><w:sdtContent>' +
      '<w:sdt><w:sdtPr><w:tag w:val="inner"/></w:sdtPr><w:sdtContent>' +
      '<w:p><w:r><w:t>inner</w:t></w:r></w:p>' +
      '</w:sdtContent></w:sdt>' +
      '</w:sdtContent></w:sdt>'
    const doc = `<w:document><w:body>${nested}<w:p><w:r><w:t>replace me</w:t></w:r></w:p></w:body></w:document>`
    const replacement = '<w:p><w:r><w:t>replaced</w:t></w:r></w:p>'
    const out = replaceBlocks(doc, new Map([[1, replacement]]))
    expect(out).toContain(nested) // the nested sdt survives byte-for-byte, untouched
    expect(out).toContain('replaced')
    expect(out).not.toContain('replace me')
    // Balanced tags — the real bug produced a dangling </w:sdtContent></w:sdt> because
    // the nested sdt got miscounted; a simple depth check over both docs confirms parity.
    const opens = (s: string) => (s.match(/<w:sdt\b[^>]*>/g) ?? []).length
    const closes = (s: string) => (s.match(/<\/w:sdt>/g) ?? []).length
    expect(opens(out)).toBe(closes(out))
    expect(getBlocks(out)).toHaveLength(2)
  })
})
