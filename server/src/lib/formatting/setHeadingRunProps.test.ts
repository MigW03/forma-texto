import { describe, it, expect } from 'vitest'
import { setHeadingRunProps } from './setHeadingRunProps'
import type { GuidelineSpec } from './guidelines'

// Minimal spec: heading sz 24, body sz 28 (distinct so Title's body-size is testable).
const g = {
  body: { sz: 28 },
  heading: {
    font: 'Arial',
    sz: 24, // 12pt
    levels: {
      1: { bold: true, case: 'upper' },
      2: { bold: false, case: 'upper' },
      3: { bold: true, case: 'sentence' },
    },
  },
} as unknown as GuidelineSpec

const para = (styleId: string, runs: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>${runs}</w:p>`

const run = (rpr: string, text = 'x') => `<w:r>${rpr}<w:t>${text}</w:t></w:r>`

describe('setHeadingRunProps', () => {
  it('stamps size, bold, and caps on an H1 run', () => {
    const xml = para('Heading1', run('<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/></w:rPr>'))
    const out = setHeadingRunProps(xml, g)
    expect(out).toContain('<w:sz w:val="24"/><w:szCs w:val="24"/>')
    expect(out).toContain('<w:b/><w:bCs/>')
    expect(out).toContain('<w:caps/>')
  })

  it('omits bold but keeps caps on H2', () => {
    const xml = para('Heading2', run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>'))
    const out = setHeadingRunProps(xml, g)
    expect(out).toContain('<w:caps/>')
    expect(out).toContain('<w:sz w:val="24"/>')
    expect(out).not.toContain('<w:b/>')
  })

  it('omits caps but keeps bold on H3 (sentence case)', () => {
    const xml = para('Heading3', run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>'))
    const out = setHeadingRunProps(xml, g)
    expect(out).not.toContain('<w:caps/>')
    expect(out).toContain('<w:b/><w:bCs/>')
  })

  it('inserts the props right after rFonts (valid CT_RPr order)', () => {
    const xml = para('Heading1', run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>'))
    const out = setHeadingRunProps(xml, g)
    expect(out).toContain('<w:rFonts w:ascii="Arial"/><w:b/><w:bCs/><w:caps/><w:sz w:val="24"/><w:szCs w:val="24"/>')
  })

  it('keeps rStyle before rFonts when both present', () => {
    const xml = para('Heading1', run('<w:rPr><w:rStyle w:val="X"/><w:rFonts w:ascii="Arial"/></w:rPr>'))
    const out = setHeadingRunProps(xml, g)
    expect(out).toContain('<w:rStyle w:val="X"/><w:rFonts w:ascii="Arial"/><w:b/><w:bCs/>')
  })

  it('strips a stale bold/size/caps and replaces with the level values', () => {
    const stale = '<w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:caps/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>'
    const xml = para('Heading3', run(stale)) // H3 = bold, no caps
    const out = setHeadingRunProps(xml, g)
    expect(out).not.toContain('w:val="40"')
    expect(out).not.toContain('<w:caps/>')
    expect(out).toContain('<w:sz w:val="24"/>')
    expect(out).toContain('<w:b/><w:bCs/>')
  })

  it('handles a run with no rPr', () => {
    const xml = para('Heading1', '<w:r><w:t>hi</w:t></w:r>')
    const out = setHeadingRunProps(xml, g)
    expect(out).toContain('<w:r><w:rPr><w:b/><w:bCs/><w:caps/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t>hi</w:t></w:r>')
  })

  it('stamps Title with bold + caps + body size', () => {
    const xml = para('Title', run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>'))
    const out = setHeadingRunProps(xml, g)
    expect(out).toContain('<w:rFonts w:ascii="Arial"/><w:b/><w:bCs/><w:caps/><w:sz w:val="28"/><w:szCs w:val="28"/>')
  })

  it('leaves non-heading paragraphs untouched', () => {
    const xml = `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>')}</w:p>`
    expect(setHeadingRunProps(xml, g)).toBe(xml)
  })

  it('stamps every run in a multi-run heading', () => {
    const xml = para('Heading1', run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>', 'A') + run('<w:rPr><w:rFonts w:ascii="Arial"/></w:rPr>', 'B'))
    const out = setHeadingRunProps(xml, g)
    expect((out.match(/<w:caps\/>/g) ?? []).length).toBe(2)
    expect((out.match(/<w:sz w:val="24"\/>/g) ?? []).length).toBe(2)
  })
})
