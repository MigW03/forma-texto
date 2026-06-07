import { describe, it, expect } from 'vitest'
import { rewriteStyles } from './rewriteStyles'

const STYLES = (inner: string) =>
  '<?xml version="1.0"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  inner +
  '</w:styles>'

describe('rewriteStyles (ABNT)', () => {
  it('replaces an existing Normal with TNR 12pt / 1.5 / 1.25cm indent', () => {
    const src = STYLES(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
        '<w:name w:val="Normal"/>' +
        '<w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="20"/></w:rPr>' +
        '</w:style>',
    )
    const out = rewriteStyles(src, 'abnt')
    const normal = out.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)![0]
    expect(normal).toContain('w:ascii="Times New Roman"')
    expect(normal).toContain('<w:sz w:val="24"/>')
    expect(normal).toContain('w:line="360"') // 1.5 spacing
    expect(normal).toContain('w:firstLine="709"') // 1.25cm
    expect(normal).not.toContain('w:ascii="Arial"') // old Arial Normal replaced
    // exactly one Normal style
    expect(out.match(/w:styleId="Normal"/g)?.length).toBe(1)
  })

  it('defines a Title style: never indented, uppercase, bold, centered', () => {
    const out = rewriteStyles(null, 'abnt')
    const title = out.match(/<w:style[^>]*w:styleId="Title"[\s\S]*?<\/w:style>/)![0]
    expect(title).toContain('<w:ind w:left="0" w:firstLine="0"/>') // never indented
    expect(title).toContain('<w:caps/>') // uppercase display
    expect(title).toContain('<w:b/>')
    expect(title).toContain('<w:jc w:val="center"/>')
    expect(title).toContain('w:ascii="Times New Roman"') // same family as body
  })

  it('justifies the Normal body for ABNT', () => {
    const out = rewriteStyles(null, 'abnt')
    const normal = out.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)![0]
    expect(normal).toContain('<w:jc w:val="both"/>')
  })

  it('inserts Heading1 in the body font, bold, left-aligned (not justified)', () => {
    const out = rewriteStyles(STYLES(''), 'abnt')
    expect(out).toContain('w:styleId="Heading1"')
    const h1 = out.match(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)![0]
    expect(h1).toContain('w:ascii="Times New Roman"') // one font throughout — matches body (§2)
    expect(h1).toContain('<w:b/>')
    expect(h1).toContain('<w:outlineLvl w:val="0"/>')
    expect(h1).toContain('w:firstLine="0"') // no first-line indent on headings
    expect(h1).toContain('<w:jc w:val="left"/>') // does not inherit body justification
  })

  it('does not collide Heading1 with Heading10-style ids', () => {
    const src = STYLES('<w:style w:type="paragraph" w:styleId="Heading10"><w:name w:val="x"/></w:style>')
    const out = rewriteStyles(src, 'abnt')
    expect(out).toContain('w:styleId="Heading10"') // untouched
    expect(out).toContain('w:styleId="Heading1"') // added
  })

  it('falls back to a scaffold when styles.xml is null', () => {
    const out = rewriteStyles(null, 'abnt')
    expect(out).toContain('<w:styles')
    expect(out).toContain('w:styleId="Normal"')
  })
})

describe('rewriteStyles (APA)', () => {
  it('uses double spacing, 0.5in indent, TNR bold headings, left-aligned body', () => {
    const out = rewriteStyles(null, 'apa')
    expect(out).toContain('w:line="480"')
    expect(out).toContain('w:firstLine="720"')
    const normal = out.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)![0]
    expect(normal).toContain('<w:jc w:val="left"/>') // APA is ragged right, never justified
    const h1 = out.match(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)![0]
    expect(h1).toContain('w:ascii="Times New Roman"')
    expect(h1).toContain('<w:b/>')
  })
})

describe('rewriteStyles (MLA)', () => {
  it('headings are not bold', () => {
    const out = rewriteStyles(null, 'mla')
    const h1 = out.match(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)![0]
    expect(h1).not.toContain('<w:b/>')
  })
})
