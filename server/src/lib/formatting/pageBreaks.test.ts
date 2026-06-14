import { describe, it, expect } from 'vitest'
import { suppressFirstHeadingPageBreak } from './pageBreaks'
import { getBlocks } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const h1 = (text: string, extraPPr = '') =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${extraPPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const body = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`

const hasBreakDisabled = (b: string) => /<w:pageBreakBefore w:val="false"\/>/.test(b)

describe('suppressFirstHeadingPageBreak', () => {
  it('disables the page break only on the first Heading1', () => {
    const out = suppressFirstHeadingPageBreak(DOC(body('Cover') + h1('1 Introdução') + body('text') + h1('2 Desenvolvimento')))
    const blocks = getBlocks(out)
    expect(hasBreakDisabled(blocks[1])).toBe(true) // first H1 — break cancelled
    expect(hasBreakDisabled(blocks[3])).toBe(false) // second H1 — untouched, keeps style break
  })

  it('leaves a document with no Heading1 byte-for-byte unchanged', () => {
    const doc = DOC(body('just body') + '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>sub</w:t></w:r></w:p>')
    expect(suppressFirstHeadingPageBreak(doc)).toBe(doc)
  })

  it('replaces an existing inline pageBreakBefore on the first H1 (no duplicate)', () => {
    const out = suppressFirstHeadingPageBreak(DOC(h1('1 Introdução', '<w:pageBreakBefore/>')))
    const first = getBlocks(out)[0]
    expect(hasBreakDisabled(first)).toBe(true)
    expect((first.match(/<w:pageBreakBefore\b/g) ?? []).length).toBe(1) // exactly one, the disabled form
  })

  it('places the override immediately after the pStyle element', () => {
    const out = suppressFirstHeadingPageBreak(DOC(h1('1 Introdução')))
    expect(getBlocks(out)[0]).toContain('<w:pStyle w:val="Heading1"/><w:pageBreakBefore w:val="false"/>')
  })
})
