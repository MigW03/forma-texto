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
})

describe('blockText', () => {
  it('concatenates run text, trimmed', () => {
    expect(blockText(getBlocks(DOC)[1])).toBe('1 INTRODUÇÃO')
    expect(blockText(getBlocks(DOC)[4])).toBe('') // empty paragraph
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
})
