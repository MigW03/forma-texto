import { describe, it, expect } from 'vitest'
import { suppressFirstHeadingPageBreak, removeRedundantChapterPageBreaks } from './pageBreaks'
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

// A manual page-break paragraph (`<w:br w:type="page"/>` with no text) and a paragraph
// whose last run carries a trailing page break — the two shapes authors use to push a
// chapter to a new page on top of the Heading1 style break.
const pageBreakPara = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'
const bodyThenBreak = (text: string) =>
  `<w:p><w:r><w:t>${text}</w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>`
const hasPageBreak = (b: string) => /<w:br\b[^>]*w:type="page"/.test(b)

describe('removeRedundantChapterPageBreaks', () => {
  it('removes a standalone manual page-break paragraph before a breaking chapter heading', () => {
    const doc = DOC(body('end of ch.1') + pageBreakPara() + h1('2 Desenvolvimento'))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(doc))
    expect(hasPageBreak(blocks[1])).toBe(false) // redundant manual break dropped
  })

  it('removes a page break trailing the previous chapter’s last paragraph', () => {
    const doc = DOC(bodyThenBreak('end of ch.1') + h1('2 Desenvolvimento'))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(doc))
    expect(hasPageBreak(blocks[0])).toBe(false)
    expect(blocks[0]).toContain('end of ch.1') // text preserved
  })

  it('does not touch the manual break before the FIRST H1 (its style break is suppressed)', () => {
    const suppressed = suppressFirstHeadingPageBreak(DOC(body('Cover') + pageBreakPara() + h1('1 Introdução')))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(suppressed))
    expect(hasPageBreak(blocks[1])).toBe(true) // first chapter keeps its only break
  })

  it('keeps a mid-paragraph page break that is still followed by text', () => {
    const mid = '<w:p><w:r><w:t>before</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>'
    const doc = DOC(mid + h1('2 Desenvolvimento'))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(doc))
    expect(hasPageBreak(blocks[0])).toBe(true) // legitimate in-content break preserved
  })

  it('walks back over an empty paragraph in the gap to reach the manual break', () => {
    const doc = DOC(body('end of ch.1') + pageBreakPara() + body('') + h1('2 Desenvolvimento'))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(doc))
    expect(hasPageBreak(blocks[1])).toBe(false) // break-only paragraph cleared despite the empty gap
  })

  it('leaves a document with no redundant breaks unchanged', () => {
    const doc = DOC(body('text') + h1('2 Desenvolvimento'))
    expect(removeRedundantChapterPageBreaks(doc)).toBe(doc)
  })
})
