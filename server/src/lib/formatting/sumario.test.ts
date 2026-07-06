import { describe, it, expect } from 'vitest'
import { buildSumario } from './sumario'
import { getBlocks, blockText } from './blocks'
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
const h2 = (text: string) => para(text, 'Heading2')
const h3 = (text: string) => para(text, 'Heading3')
const sumarioLabel = para('SUMÁRIO', 'ReferencesHeading')

const styleOf = (block: string) => block.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? null
const hasTab = (block: string) => block.includes('<w:tab/>')
const isBold = (block: string) => block.includes('<w:b/>')

/** Build a simple PretextualResult with a sumário section and a given bodyStart. */
function pretextualWith(sumarioBlockStart: number, sumarioBlockEnd: number, bodyStart: number): PretextualResult {
  return {
    sections: [{ kind: 'sumario', blockStart: sumarioBlockStart, blockEnd: sumarioBlockEnd }],
    bodyStart,
  }
}

describe('buildSumario', () => {
  it('returns document unchanged when no sumário section', () => {
    const doc = DOC(h1('1 INTRODUÇÃO') + para('body'))
    const result = buildSumario(doc, { sections: [], bodyStart: 0 })
    expect(result).toBe(doc)
  })

  it('returns document unchanged when no body headings', () => {
    const doc = DOC(sumarioLabel + para('empty') + h1('1 INTRODUÇÃO'))
    // bodyStart beyond the heading so it is excluded
    const result = buildSumario(doc, pretextualWith(0, 1, 3))
    expect(result).toBe(doc)
  })

  it('replaces existing sumário content with heading entries', () => {
    const doc = DOC(
      sumarioLabel +
      para('old entry 1') +
      para('old entry 2') +
      h1('1 INTRODUÇÃO') +
      para('body text') +
      h2('1.1 Contexto'),
    )
    // sumário: blocks 0-2, body starts at 3
    // output: [label, h1entry, h2entry, h1body, bodyPara, h2body] = 6
    const result = buildSumario(doc, pretextualWith(0, 2, 3))
    const blocks = getBlocks(result)
    expect(blocks).toHaveLength(6)
    expect(blockText(blocks[1])).toContain('1 INTRODUÇÃO')
    expect(blockText(blocks[2])).toContain('1.1 Contexto')
    expect(isBold(blocks[1])).toBe(true)   // H1 → bold
    expect(isBold(blocks[2])).toBe(false)  // H2 → not bold
    expect(hasTab(blocks[1])).toBe(true)   // tab for blank page number
    expect(hasTab(blocks[2])).toBe(true)
  })

  it('indents H2 and H3 entries', () => {
    const doc = DOC(
      sumarioLabel +
      para('old') +
      h1('1 INTRO') +
      h2('1.1 SEC') +
      h3('1.1.1 SUBSEC'),
    )
    // sumário: 0-1, body: 2-4. Output: [label, h1e, h2e, h3e, h1body, h2body, h3body] = 7
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const blocks = getBlocks(result)
    expect(blocks).toHaveLength(7)
    expect(blocks[1]).toContain('w:left="0"')      // H1 flush left
    expect(blocks[2]).toContain('w:left="709"')    // H2 indent
    expect(blocks[3]).toContain('w:left="1418"')   // H3 indent
  })

  it('inserts dot-leader tab stop on each entry', () => {
    const doc = DOC(sumarioLabel + para('old') + h1('1 INTRO'))
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const blocks = getBlocks(result)
    expect(blocks[1]).toContain('w:leader="dot"')
    expect(blocks[1]).toContain('w:val="right"')
  })

  it('appends entries after a label-only sumário (no existing content blocks)', () => {
    // sumário section has only the label heading (blockStart === blockEnd)
    const doc = DOC(sumarioLabel + h1('1 INTRO') + h2('1.1 SEC'))
    // sumário: block 0 only, body starts at 1
    // output: [label, h1entry, h2entry, h1body, h2body] = 5
    const result = buildSumario(doc, pretextualWith(0, 0, 1))
    const blocks = getBlocks(result)
    expect(blocks).toHaveLength(5)
    expect(blockText(blocks[1])).toContain('1 INTRO')
    expect(blockText(blocks[2])).toContain('1.1 SEC')
  })

  it('excludes headings before bodyStart (pré-textual region)', () => {
    // A Heading1 that is part of front matter should not appear in the sumário
    const doc = DOC(
      h1('RESUMO HEADING') +  // block 0: pretextual heading, style Heading1
      sumarioLabel +           // block 1: SUMÁRIO label
      para('old entry') +      // block 2: existing content
      h1('1 INTRO'),           // block 3: real body heading
    )
    // output: [h1pretex, label, h1entry, h1body] = 4
    const result = buildSumario(doc, pretextualWith(1, 2, 3))
    const blocks = getBlocks(result)
    expect(blocks).toHaveLength(4)
    expect(blockText(blocks[2])).toContain('1 INTRO')
    expect(blockText(blocks[2])).not.toContain('RESUMO')
  })

  it('escapes XML special characters in heading text', () => {
    // Use only & (not <) — raw < in test helper XML breaks blockText's regex
    const doc = DOC(sumarioLabel + para('old') + h1('1 A & B'))
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const blocks = getBlocks(result)
    expect(blocks[1]).toContain('A &amp; B')
  })

  it('more existing content blocks than new entries — extra blocks deleted', () => {
    const doc = DOC(
      sumarioLabel +
      para('old 1') + para('old 2') + para('old 3') + para('old 4') +
      h1('1 INTRO'),
    )
    // sumário: 0-4, body: 5. Output: [label, h1entry, h1body] = 3
    const result = buildSumario(doc, pretextualWith(0, 4, 5))
    const blocks = getBlocks(result)
    expect(blocks).toHaveLength(3)
    expect(blockText(blocks[1])).toContain('1 INTRO')
  })

  it('resets justification and first-line indent so entries do not inherit the justified body style', () => {
    const doc = DOC(sumarioLabel + para('old') + h1('1 INTRO'))
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const blocks = getBlocks(result)
    expect(blocks[1]).toContain('<w:jc w:val="left"/>')
    expect(blocks[1]).toContain('w:firstLine="0"')
  })

  it('skips a paragraph carrying a heading style whose text is too long to be a real heading', () => {
    const longBio = 'Beatriz Milhazes, 1960, vive e trabalha no Rio de Janeiro. '.repeat(5)
    const doc = DOC(
      sumarioLabel +
      para('old') +
      h2('BEATRIZ MILHAZES') +
      h3(longBio) + // mis-styled body paragraph, not a real heading
      h1('1 INTRO'),
    )
    // sumário: 0-1, body: 2-4. Only the two short headings become entries.
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const blocks = getBlocks(result)
    // label(0), entryBEATRIZ(1), entryINTRO(2), then the untouched body: h2(3), h3 longBio(4), h1(5)
    expect(blocks).toHaveLength(6)
    const entryTexts = [blocks[1], blocks[2]].map(blockText)
    expect(entryTexts).toEqual(['BEATRIZ MILHAZES', '1 INTRO'])
    // The long paragraph stays in the body (untouched) but must not be duplicated as a TOC entry.
    expect(blockText(blocks[1])).not.toContain('Milhazes, 1960')
    expect(blockText(blocks[2])).not.toContain('Milhazes, 1960')
  })
})
