import { describe, it, expect } from 'vitest'
import { suppressFirstHeadingPageBreak, removeRedundantChapterPageBreaks, removeTrailingBlankPages } from './pageBreaks'
import { getBlocks } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const h1 = (text: string, extraPPr = '') =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/>${extraPPr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const referencesHeading = (text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ReferencesHeading"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
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

  it('removes a redundant manual break before REFERÊNCIAS the same way it does for a chapter', () => {
    const doc = DOC(body('closing paragraph') + pageBreakPara() + referencesHeading('REFERÊNCIAS'))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(doc))
    expect(hasPageBreak(blocks[1])).toBe(false)
  })

  it('strips the tab-wrapped manual break shape a Google Docs export produces before REFERÊNCIAS', () => {
    // The exact shape found in a real exported .docx: a tab, then the page break, then
    // another tab, with no `<w:t>` text anywhere in the paragraph.
    const tabBreakTab = '<w:p><w:r><w:tab/></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:tab/></w:r></w:p>'
    const doc = DOC(body('closing paragraph') + tabBreakTab + referencesHeading('REFERÊNCIAS'))
    const blocks = getBlocks(removeRedundantChapterPageBreaks(doc))
    expect(hasPageBreak(blocks[1])).toBe(false)
    expect(blocks[1]).toContain('<w:tab/>') // the tabs themselves are harmless, left alone
  })
})

const blank = () => '<w:p/>'
const blankHeading = () => '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p>'
const image = () => '<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>'

describe('removeTrailingBlankPages', () => {
  it('drops a manual page break trailing the last real content', () => {
    const doc = DOC(body('last paragraph') + pageBreakPara())
    const blocks = getBlocks(removeTrailingBlankPages(doc))
    expect(blocks).toHaveLength(1)
    expect(hasPageBreak(blocks[0])).toBe(false)
    expect(blocks[0]).toContain('last paragraph')
  })

  it('strips a page break trailing the last paragraph\'s own text', () => {
    const doc = DOC(bodyThenBreak('last paragraph'))
    const blocks = getBlocks(removeTrailingBlankPages(doc))
    expect(hasPageBreak(blocks[0])).toBe(false)
    expect(blocks[0]).toContain('last paragraph')
  })

  it('removes trailing blank spacer paragraphs after the last content', () => {
    const doc = DOC(body('last paragraph') + blank() + blank())
    const blocks = getBlocks(removeTrailingBlankPages(doc))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('last paragraph')
  })

  it('removes a trailing empty paragraph even when styled Heading1 (forces its own blank page)', () => {
    const doc = DOC(body('last paragraph') + blankHeading())
    const blocks = getBlocks(removeTrailingBlankPages(doc))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toContain('last paragraph')
  })

  it('never removes a trailing image paragraph', () => {
    const doc = DOC(body('caption above') + image())
    expect(removeTrailingBlankPages(doc)).toBe(doc)
  })

  it('leaves a document with no trailing blank run unchanged', () => {
    const doc = DOC(body('text') + h1('1 Introdução') + body('more text'))
    expect(removeTrailingBlankPages(doc)).toBe(doc)
  })

  it('never touches a wholly blank document', () => {
    const doc = DOC(blank() + blank())
    expect(removeTrailingBlankPages(doc)).toBe(doc)
  })
})
