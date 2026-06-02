import { describe, it, expect } from 'vitest'
import { stripDirectOverrides } from './stripOverrides'

describe('stripDirectOverrides', () => {
  it('removes layout properties (sz, rFonts, spacing, ind, jc)', () => {
    const doc =
      '<w:p><w:pPr><w:spacing w:line="240"/><w:ind w:firstLine="0"/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>' +
      '<w:t>Hello</w:t></w:r></w:p>'
    const out = stripDirectOverrides(doc)
    expect(out).not.toContain('<w:spacing')
    expect(out).not.toContain('<w:ind')
    expect(out).not.toContain('<w:jc')
    expect(out).not.toContain('<w:rFonts')
    expect(out).not.toContain('<w:sz ')
    expect(out).not.toContain('<w:szCs')
  })

  it('preserves semantic properties (bold, italic, underline) and text', () => {
    const doc =
      '<w:r><w:rPr><w:b/><w:i/><w:u w:val="single"/><w:sz w:val="28"/></w:rPr><w:t>Hi</w:t></w:r>'
    const out = stripDirectOverrides(doc)
    expect(out).toContain('<w:b/>')
    expect(out).toContain('<w:i/>')
    expect(out).toContain('<w:u w:val="single"/>')
    expect(out).toContain('<w:t>Hi</w:t>')
    expect(out).not.toContain('<w:sz ')
  })

  it('does not remove w:szCs when targeting w:sz boundaries', () => {
    // both should be gone, but via their own rules — sanity that sz rule didn't skip szCs
    const out = stripDirectOverrides('<w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>')
    expect(out).toBe('<w:rPr></w:rPr>')
  })
})
