import { describe, it, expect } from 'vitest'
import { demoteImplausibleHeadings } from './headingSanity'
import { getBlocks, blockText } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const para = (text: string, style?: string) => {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`
}
const listItem = (text: string, style: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const blank = () => '<w:p><w:r><w:t></w:t></w:r></w:p>'
const imagePara = '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>'

const styleOf = (block: string) => block.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? null

const longBio = 'Beatriz Milhazes, 1960, vive e trabalha no Rio de Janeiro. '.repeat(5)

describe('demoteImplausibleHeadings', () => {
  it('demotes a heading-styled paragraph whose text is far too long to be a real heading', () => {
    const doc = DOC(para('BEATRIZ MILHAZES', 'Heading2') + para(longBio, 'Heading3') + para('1 INTRO', 'Heading1'))
    const result = demoteImplausibleHeadings(doc)
    const blocks = getBlocks(result)
    expect(styleOf(blocks[1])).toBeNull() // falls back to Normal
    expect(blockText(blocks[1])).toContain('Milhazes, 1960')
  })

  it('leaves short, real headings untouched', () => {
    const doc = DOC(para('BEATRIZ MILHAZES', 'Heading2') + para('1 INTRO', 'Heading1'))
    const result = demoteImplausibleHeadings(doc)
    expect(result).toBe(doc)
  })

  it('leaves non-heading-styled paragraphs untouched regardless of length', () => {
    const doc = DOC(para(longBio, 'Normal') + para('1 INTRO', 'Heading1'))
    const result = demoteImplausibleHeadings(doc)
    expect(result).toBe(doc)
  })

  it('does not demote a long paragraph that is a list item, even if heading-styled', () => {
    const doc = DOC(listItem(longBio, 'Heading2') + para('1 INTRO', 'Heading1'))
    const result = demoteImplausibleHeadings(doc)
    expect(result).toBe(doc)
  })

  it('demotes an over-long Title paragraph too', () => {
    const doc = DOC(para(longBio, 'Title') + para('1 INTRO', 'Heading1'))
    const result = demoteImplausibleHeadings(doc)
    const blocks = getBlocks(result)
    expect(styleOf(blocks[0])).toBeNull()
  })

  it('is idempotent', () => {
    const doc = DOC(para(longBio, 'Heading3') + para('1 INTRO', 'Heading1'))
    const once = demoteImplausibleHeadings(doc)
    const twice = demoteImplausibleHeadings(once)
    expect(twice).toBe(once)
  })

  it('returns document unchanged when there is nothing to demote', () => {
    const doc = DOC(para('body text', 'Normal'))
    expect(demoteImplausibleHeadings(doc)).toBe(doc)
  })

  it('demotes a short heading-styled sentence that leads directly into a figure label', () => {
    // Real-world case: a bolded description ("Com 800 metros quadrados…") left in a
    // Heading3 style right before "Figura 4:" — under MAX_HEADING_CHARS, so length alone
    // never catches it, but it got swept into the sumário as a bogus TOC entry and left
    // stranded on its own page while the actual figure moved to the next one.
    const doc = DOC(
      para('EDUARDO KOBRA', 'Heading2') +
      para('Corpo sobre o artista.', 'Normal') +
      para('Com 800 metros quadrados, este painel é o maior da série.', 'Heading3') +
      para('Figura 4: Eduardo Kobra - Ellis Island', 'Normal') +
      imagePara,
    )
    const result = demoteImplausibleHeadings(doc)
    const blocks = getBlocks(result)
    expect(styleOf(blocks[2])).toBeNull()
    expect(blockText(blocks[2])).toContain('800 metros')
    // The real heading two blocks earlier is untouched.
    expect(styleOf(blocks[0])).toBe('Heading2')
  })

  it('also catches the caption lead-in when the image itself (not a label) follows directly', () => {
    const doc = DOC(para('Uma bela obra de arte urbana.', 'Heading3') + imagePara)
    const result = demoteImplausibleHeadings(doc)
    expect(styleOf(getBlocks(result)[0])).toBeNull()
  })

  it('tolerates a single blank spacer paragraph before the figure label', () => {
    const doc = DOC(para('Uma bela obra de arte urbana.', 'Heading3') + blank() + para('Figura 1: Exemplo', 'Normal') + imagePara)
    const result = demoteImplausibleHeadings(doc)
    expect(styleOf(getBlocks(result)[0])).toBeNull()
  })

  it('does not demote a real heading that is simply followed by ordinary body text before any figure', () => {
    const doc = DOC(para('EDUARDO KOBRA', 'Heading2') + para('Corpo sobre o artista, bastante longo antes da figura.', 'Normal') + para('Figura 4: Exemplo', 'Normal') + imagePara)
    const result = demoteImplausibleHeadings(doc)
    expect(result).toBe(doc)
  })
})
