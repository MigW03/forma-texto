import { describe, it, expect } from 'vitest'
import { validateOutput, type ValidationContext } from './validateOutput'
import type { PretextualResult } from './preTextual'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const para = (text: string, style?: string) => {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`
}
const h1 = (text: string) => para(text, 'Heading1')

/** A `buildTocEntry`-shaped sumário entry (matches `ENTRY_SIGNATURE_RE` in sumarioPagination.ts). */
const tocEntry = (text: string, numbered: boolean) =>
  '<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9061"/></w:tabs><w:suppressAutoHyphens/></w:pPr>' +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` +
  '<w:r><w:tab/></w:r>' +
  (numbered ? '<w:r><w:t>3</w:t></w:r>' : '') +
  '</w:p>'
const sumarioLabel = para('SUMÁRIO', 'ReferencesHeading')

const noPretextual: PretextualResult = { sections: [], bodyStart: 0 }
const baseCtx: ValidationContext = { pretextual: noPretextual, referencesFlagged: false, referenceRegion: null }

describe('validateOutput', () => {
  it('returns no issues for a clean, well-formed document', () => {
    const doc = DOC(h1('1 INTRODUÇÃO') + para('body text'))
    expect(validateOutput(doc, baseCtx)).toEqual([])
  })

  describe('malformed_xml', () => {
    it('flags a mismatched closing tag', () => {
      const doc = DOC('<w:p><w:r><w:t>oops</w:t></w:r></w:tbl>')
      const issues = validateOutput(doc, baseCtx)
      expect(issues.map(i => i.code)).toContain('malformed_xml')
    })

    it('flags an unclosed tag', () => {
      const doc = DOC('<w:p><w:r><w:t>oops</w:t></w:r>')
      const issues = validateOutput(doc, baseCtx)
      expect(issues.map(i => i.code)).toContain('malformed_xml')
    })

    it('flags a bare unescaped ampersand', () => {
      const doc = DOC(para('Alice & Bob'))
      const issues = validateOutput(doc, baseCtx)
      expect(issues.map(i => i.code)).toContain('malformed_xml')
    })

    it('does not flag a properly escaped ampersand', () => {
      const doc = DOC(para('Alice &amp; Bob'))
      expect(validateOutput(doc, baseCtx)).toEqual([])
    })

    it('does not flag a self-closing tag or a comment', () => {
      const doc = DOC('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><!-- note --><w:r><w:t>ok</w:t></w:r></w:p>')
      expect(validateOutput(doc, baseCtx)).toEqual([])
    })
  })

  it('flags a leftover red caption placeholder', () => {
    const doc = DOC('<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>[inserir legenda da figura]</w:t></w:r></w:p>')
    const issues = validateOutput(doc, baseCtx)
    expect(issues.map(i => i.code)).toContain('leftover_placeholder')
  })

  describe('sumario_mismatch', () => {
    const pretextual: PretextualResult = {
      sections: [{ kind: 'sumario', blockStart: 0, blockEnd: 0 }],
      bodyStart: 1,
    }

    it('flags when the sumário entry count does not match the body heading count', () => {
      const doc = DOC(sumarioLabel + tocEntry('1 INTRODUÇÃO', true) + h1('1 INTRODUÇÃO') + h1('2 DESENVOLVIMENTO'))
      const issues = validateOutput(doc, { ...baseCtx, pretextual })
      expect(issues.map(i => i.code)).toContain('sumario_mismatch')
    })

    it('does not flag when counts match', () => {
      const doc = DOC(sumarioLabel + tocEntry('1 INTRODUÇÃO', true) + h1('1 INTRODUÇÃO'))
      const issues = validateOutput(doc, { ...baseCtx, pretextual })
      expect(issues.map(i => i.code)).not.toContain('sumario_mismatch')
    })

    it('is skipped when there is no sumário section', () => {
      const doc = DOC(h1('1 INTRODUÇÃO') + h1('2 DESENVOLVIMENTO'))
      const issues = validateOutput(doc, baseCtx)
      expect(issues.map(i => i.code)).not.toContain('sumario_mismatch')
    })
  })

  describe('references_not_located', () => {
    it('flags when references were flagged but no region was located', () => {
      const doc = DOC(para('body'))
      const issues = validateOutput(doc, { ...baseCtx, referencesFlagged: true, referenceRegion: null })
      expect(issues.map(i => i.code)).toContain('references_not_located')
    })

    it('does not flag when a region was located', () => {
      const doc = DOC(para('body'))
      const issues = validateOutput(doc, { ...baseCtx, referencesFlagged: true, referenceRegion: { headingIdx: 0, entryIndices: [1] } })
      expect(issues.map(i => i.code)).not.toContain('references_not_located')
    })

    it('does not flag when references were never flagged', () => {
      const doc = DOC(para('body'))
      expect(validateOutput(doc, baseCtx)).toEqual([])
    })
  })

  describe('page_number_unresolved', () => {
    const pretextual: PretextualResult = { sections: [], bodyStart: 2 }

    it('flags a pgNumType still at the "1" placeholder when there is front matter', () => {
      const doc = DOC(`<w:sectPr><w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr>`)
      const issues = validateOutput(doc, { ...baseCtx, pretextual })
      expect(issues.map(i => i.code)).toContain('page_number_unresolved')
    })

    it('does not flag once resolved to a real value', () => {
      const doc = DOC(`<w:sectPr><w:pgNumType w:fmt="decimal" w:start="4"/></w:sectPr>`)
      const issues = validateOutput(doc, { ...baseCtx, pretextual })
      expect(issues.map(i => i.code)).not.toContain('page_number_unresolved')
    })

    it('is skipped when there is no front matter (bodyStart 0)', () => {
      const doc = DOC(`<w:sectPr><w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr>`)
      expect(validateOutput(doc, baseCtx)).toEqual([])
    })
  })
})
