import { describe, it, expect } from 'vitest'
import { setRunFonts } from './setRunFonts'

const RF = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>'

describe('setRunFonts', () => {
  it('adds an rPr + rFonts to a run that has none', () => {
    const out = setRunFonts('<w:r><w:t>hi</w:t></w:r>', 'Arial')
    expect(out).toBe(`<w:r><w:rPr>${RF}</w:rPr><w:t>hi</w:t></w:r>`)
  })

  it('inserts rFonts as the first rPr child when other props exist', () => {
    const out = setRunFonts('<w:r><w:rPr><w:b/></w:rPr><w:t>x</w:t></w:r>', 'Arial')
    expect(out).toBe(`<w:r><w:rPr>${RF}<w:b/></w:rPr><w:t>x</w:t></w:r>`)
  })

  it('replaces an existing rFonts (no duplicate, our family wins)', () => {
    const out = setRunFonts(
      '<w:r><w:rPr><w:rFonts w:ascii="Montserrat"/><w:i/></w:rPr><w:t>x</w:t></w:r>',
      'Arial',
    )
    expect(out).toBe(`<w:r><w:rPr>${RF}<w:i/></w:rPr><w:t>x</w:t></w:r>`)
    expect(out).not.toContain('Montserrat')
    expect((out.match(/<w:rFonts/g) ?? []).length).toBe(1)
  })

  it('keeps rFonts after rStyle (CT_RPr order)', () => {
    const out = setRunFonts('<w:r><w:rPr><w:rStyle w:val="X"/></w:rPr><w:t>x</w:t></w:r>', 'Arial')
    expect(out).toBe(`<w:r><w:rPr><w:rStyle w:val="X"/>${RF}</w:rPr><w:t>x</w:t></w:r>`)
  })

  it('handles a self-closing rPr', () => {
    const out = setRunFonts('<w:r><w:rPr/><w:t>x</w:t></w:r>', 'Arial')
    expect(out).toBe(`<w:r><w:rPr>${RF}</w:rPr><w:t>x</w:t></w:r>`)
  })

  it('stamps every run and leaves non-run rPr (paragraph mark) untouched', () => {
    const xml = '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>'
    const out = setRunFonts(xml, 'Arial')
    expect((out.match(/<w:rFonts/g) ?? []).length).toBe(2) // two runs, not the pPr mark
    expect(out).toContain('<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>') // paragraph-mark rPr unchanged
  })
})
