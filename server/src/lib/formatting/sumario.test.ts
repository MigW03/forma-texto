import { describe, it, expect } from 'vitest'
import { buildSumario, sumarioTabPos, SUMARIO_PAGE_PLACEHOLDER } from './sumario'
import { getBlocks, blockText } from './blocks'
import { classifyPretextual, type PretextualResult } from './preTextual'

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

  it('stamps a page-number placeholder after the tab, never a bare run', () => {
    // Real bug: with NOTHING after a right tab-stop, docx-preview's tab-stop
    // word-spacing calibration blows up and wraps the entry onto extra lines —
    // confirmed against a real document. A placeholder (any content) avoids it;
    // `paginateSumario`/`setEntryPageNumber` overwrites it once real numbers exist.
    const doc = DOC(sumarioLabel + para('old') + h1('1 INTRODUÇÃO'))
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const entry = getBlocks(result)[1]
    expect(entry).toContain(`<w:r><w:tab/></w:r><w:r><w:t>${SUMARIO_PAGE_PLACEHOLDER}</w:t></w:r></w:p>`)
    expect(blockText(entry)).toBe(`1 INTRODUÇÃO${SUMARIO_PAGE_PLACEHOLDER}`)
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

  it('inserts a plain right tab stop (no dot leader) on each entry', () => {
    const doc = DOC(sumarioLabel + para('old') + h1('1 INTRO'))
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    const blocks = getBlocks(result)
    expect(blocks[1]).not.toContain('w:leader')
    expect(blocks[1]).toContain('w:val="right"')
    // No sectPr in the fixture → fallback tab position, inside the ABNT text width.
    expect(blocks[1]).toContain('w:pos="9061"')
  })

  it('derives the tab position from the document sectPr (inside the text width)', () => {
    const body =
      sumarioLabel + para('old') + h1('1 INTRO') +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
    const doc = DOC(body)
    // Letter page: 12240 − 1440 − 1440 = 9360 content width → tab at 9360 − 10.
    expect(sumarioTabPos(doc)).toBe(9350)
    const result = buildSumario(doc, pretextualWith(0, 1, 2))
    expect(getBlocks(result)[1]).toContain('w:pos="9350"')
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
    // Trailing "—" is the page-number placeholder (SUMARIO_PAGE_PLACEHOLDER) — real
    // pagination hasn't run on this doc yet.
    expect(entryTexts).toEqual(['BEATRIZ MILHAZES—', '1 INTRO—'])
    // The long paragraph stays in the body (untouched) but must not be duplicated as a TOC entry.
    expect(blockText(blocks[1])).not.toContain('Milhazes, 1960')
    expect(blockText(blocks[2])).not.toContain('Milhazes, 1960')
  })

  it('regression: an unnumbered "Introdução" heading survives the sumário rebuild end-to-end', () => {
    // Reproduces the real-world bug: classifyPretextual (fed the raw pre-Step-D text,
    // where the heading is still Normal-styled and its "1" — if any — comes from Word's
    // <w:numPr> list numbering rather than literal text) used to mis-set bodyStart past
    // the real "Introdução" heading, so buildSumario deleted it while rebuilding the TOC.
    const texts = [
      'SUMÁRIO',                                             // 0
      '1 INTRODUÇÃO ... 5',                                  // 1 TOC entry
      'Introdução',                                          // 2 real heading (Heading1 by the time buildSumario runs)
      'Este trabalho aborda o tema X de forma abrangente.',  // 3 body prose
    ]
    const pretextual = classifyPretextual(texts)
    expect(pretextual.bodyStart).toBe(2) // sanity: the fix locates the real heading

    const doc = DOC(
      sumarioLabel +
      para('1 INTRODUÇÃO ... 5') +
      h1('Introdução') +
      para('Este trabalho aborda o tema X de forma abrangente.'),
    )
    const result = buildSumario(doc, pretextual)
    const texts2 = getBlocks(result).map(blockText)
    expect(texts2.some(t => t.includes('Este trabalho aborda o tema X'))).toBe(true)
    expect(texts2.some(t => t === 'Introdução')).toBe(true)
  })
})
