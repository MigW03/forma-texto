import { describe, it, expect } from 'vitest'
import { applyHeadingNumbering } from './headingNumbering'
import { getBlocks, blockText } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const para = (text: string, style?: string) => {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`
}
const h1 = (text: string) => para(text, 'Heading1')
const h2 = (text: string) => para(text, 'Heading2')
const h3 = (text: string) => para(text, 'Heading3')

describe('applyHeadingNumbering', () => {
  it('numbers unnumbered headings sequentially, respecting hierarchy', () => {
    const doc = DOC(
      h1('INTRODUÇÃO') +
      para('corpo') +
      h2('Contexto') +
      h3('Detalhe') +
      h1('MÉTODOS') +
      h2('Coleta de dados'),
    )
    const out = applyHeadingNumbering(doc)
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('1 INTRODUÇÃO')
    expect(blockText(blocks[2])).toBe('1.1 Contexto')
    expect(blockText(blocks[3])).toBe('1.1.1 Detalhe')
    expect(blockText(blocks[4])).toBe('2 MÉTODOS')
    expect(blockText(blocks[5])).toBe('2.1 Coleta de dados')
  })

  it('replaces an existing numeric prefix instead of doubling it', () => {
    const doc = DOC(h1('1 INTRODUÇÃO') + h1('3. MÉTODOS') + h2('2.5 Coleta'))
    const out = applyHeadingNumbering(doc)
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('1 INTRODUÇÃO') // already correct — untouched (no-op)
    expect(blockText(blocks[1])).toBe('2 MÉTODOS') // wrong prefix replaced
    expect(blockText(blocks[2])).toBe('2.1 Coleta')
  })

  it('normalizes an inconsistent mix — some headings numbered, some not', () => {
    // The reported bug: one heading already numbered, its siblings bare.
    const doc = DOC(h1('1 INTRODUÇÃO') + h1('MÉTODOS') + h1('CONSIDERAÇÕES FINAIS'))
    const out = applyHeadingNumbering(doc)
    const blocks = getBlocks(out)
    expect([blockText(blocks[0]), blockText(blocks[1]), blockText(blocks[2])]).toEqual([
      '1 INTRODUÇÃO', '2 MÉTODOS', '3 CONSIDERAÇÕES FINAIS',
    ])
  })

  it('treats an h2/h3 with no preceding h1 as belonging to an implicit first chapter', () => {
    const doc = DOC(h2('Contexto') + h3('Detalhe'))
    const out = applyHeadingNumbering(doc)
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('1.1 Contexto')
    expect(blockText(blocks[1])).toBe('1.1.1 Detalhe')
  })

  it('preserves bold/run formatting via the run-preserving splice', () => {
    const boldH1 = '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>INTRODUÇÃO</w:t></w:r></w:p>'
    const out = applyHeadingNumbering(DOC(boldH1))
    const blocks = getBlocks(out)
    expect(blocks[0]).toContain('<w:b/>')
    expect(blockText(blocks[0])).toBe('1 INTRODUÇÃO')
  })

  it('skips pré-textual front matter before bodyStartIndex', () => {
    // A pretextual-styled heading never carries Heading1-3, but bodyStartIndex is still
    // honored as a defensive cutoff — headings before it are left completely alone.
    const doc = DOC(h1('SHOULD BE SKIPPED') + h1('1 INTRODUÇÃO'))
    const out = applyHeadingNumbering(doc, { bodyStartIndex: 1 })
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('SHOULD BE SKIPPED') // untouched
    expect(blockText(blocks[1])).toBe('1 INTRODUÇÃO')
  })

  it('excludes the appendix/annex region even if Step D styled it Heading1', () => {
    const doc = DOC(h1('1 INTRODUÇÃO') + h1('2 MÉTODOS') + h1('APÊNDICE A — Questionário'))
    const out = applyHeadingNumbering(doc, { stopIndex: 2 })
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('1 INTRODUÇÃO')
    expect(blockText(blocks[1])).toBe('2 MÉTODOS')
    expect(blockText(blocks[2])).toBe('APÊNDICE A — Questionário') // untouched
  })

  it('is idempotent — a second run is a no-op', () => {
    const doc = DOC(h1('INTRODUÇÃO') + h2('Contexto') + h1('MÉTODOS'))
    const once = applyHeadingNumbering(doc)
    const twice = applyHeadingNumbering(once)
    expect(twice).toBe(once)
  })

  it('leaves non-heading paragraphs and unnumbered title styles untouched', () => {
    const doc = DOC(
      para('MEU TÍTULO', 'Title') +
      para('RESUMO', 'ReferencesHeading') +
      h1('INTRODUÇÃO') +
      para('corpo comum'),
    )
    const out = applyHeadingNumbering(doc)
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('MEU TÍTULO')
    expect(blockText(blocks[1])).toBe('RESUMO')
    expect(blockText(blocks[2])).toBe('1 INTRODUÇÃO')
    expect(blockText(blocks[3])).toBe('corpo comum')
  })

  it('returns the document unchanged when there are no Heading1-3 paragraphs', () => {
    const doc = DOC(para('só corpo') + para('mais corpo'))
    expect(applyHeadingNumbering(doc)).toBe(doc)
  })
})
