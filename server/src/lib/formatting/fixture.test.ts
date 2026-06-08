import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unzipDocx, zipDocx } from './docxZip'
import { applyStepA } from './applyStepA'

// The committed deliberately-broken fixture (regenerate: node test_assets/buildFixture.mjs)
const fixturePath = new URL('../../../test_assets/formatting_test_input.docx', import.meta.url)

describe('Step A against the real fixture docx', () => {
  it('fixes fonts, spacing, margins and reopens cleanly', () => {
    const buf = new Uint8Array(readFileSync(fixturePath))
    const { files, documentXml, stylesXml } = unzipDocx(buf)

    // sanity: the fixture really is broken
    expect(stylesXml).toContain('w:ascii="Arial"')
    expect(documentXml).toContain('w:top="1440"')

    const out = applyStepA({ documentXml, stylesXml, guideline: 'abnt' })
    const reopened = unzipDocx(zipDocx(files, out))

    // Font policy: the fixture is consistently Arial (an accepted ABNT family),
    // so it is KEPT — body and headings both Arial, never mixed. Only size/spacing
    // are corrected (12pt / 1.5).
    const normal = reopened.stylesXml!.match(/<w:style[^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)![0]
    expect(normal).toContain('w:ascii="Arial"')
    expect(normal).not.toContain('Times New Roman')
    expect(normal).toContain('<w:sz w:val="24"/>')
    expect(normal).toContain('w:line="360"')

    // heading styles created, in the SAME family as the body (Arial)
    expect(reopened.stylesXml).toContain('w:styleId="Heading1"')
    const h1 = reopened.stylesXml!.match(/<w:style[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/)![0]
    expect(h1).toContain('w:ascii="Arial"')

    // ABNT margins applied
    expect(reopened.documentXml).toContain('w:top="1701"')
    expect(reopened.documentXml).not.toContain('w:top="1440"')

    // direct overrides stripped from body, but content + bold on the title kept
    expect(reopened.documentXml).not.toContain('<w:rFonts')
    expect(reopened.documentXml).toContain('1 INTRODUÇÃO')
    expect(reopened.documentXml).toContain('<w:b/>')
  })
})
