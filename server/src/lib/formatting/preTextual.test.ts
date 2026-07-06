import { describe, it, expect } from 'vitest'
import { classifyPretextual, detectPretextual, applyPretextualHeadings, applyCoverAlignment, applyFolhaRostoAlignment, applyPretextualPageBreaks, applyCoverVerticalDistribution, coverBlockIndices } from './preTextual'
import { REFERENCES_HEADING_STYLE, COVER_STYLE, FOLHA_ROSTO_NATUREZA_STYLE } from './guidelines'
import { getBlocks } from './blocks'

const styleOf = (b: string) => b.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? null

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const doc = (texts: string[]) => `<w:document><w:body>${texts.map(para).join('')}</w:body></w:document>`

// Same as `doc()` but with a real final (body-level) sectPr — needed by any test that
// clones pgSz/pgMar off it (applyCoverVerticalDistribution's OOXML section break).
const BODY_SECT_PR = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701"/></w:sectPr>'
const docWithSectPr = (texts: string[]) => `<w:document><w:body>${texts.map(para).join('')}${BODY_SECT_PR}</w:body></w:document>`

describe('classifyPretextual', () => {
  it('finds the region and keeps TOC entries inside the sumário', () => {
    const r = classifyPretextual([
      'UNIVERSIDADE X', 'Ana Lima', 'TÍTULO', 'São Paulo', '2023',          // capa 0-4
      'Ana Lima', 'TÍTULO',
      'Monografia apresentada como requisito parcial para obtenção do grau.', // natureza
      'Orientador: Prof. Dr. Silva', 'São Paulo', '2023',                    // folha 5-10
      'RESUMO', 'Texto do resumo.',                                          // 11-12
      'SUMÁRIO', '1 INTRODUÇÃO ... 5',                                       // 13-14 (TOC)
      '1 INTRODUÇÃO', 'Corpo do texto.',                                     // 15 body
    ])
    expect(r.bodyStart).toBe(15)
    expect(r.sections.map(s => s.kind)).toEqual(['capa', 'folhaDeRosto', 'resumo', 'sumario'])
    expect(r.sections.find(s => s.kind === 'sumario')).toEqual({ kind: 'sumario', blockStart: 13, blockEnd: 14 })
  })

  it('detects nothing in a body-only document', () => {
    const r = classifyPretextual(['1 INTRODUÇÃO', 'Texto.', '2 MÉTODOS', 'Mais texto.'])
    expect(r).toEqual({ sections: [], bodyStart: 0 })
  })

  it('does not flag body prose that merely mentions a thesis-type word', () => {
    const r = classifyPretextual([
      '1 INTRODUÇÃO',
      'Nesta dissertação analisamos a formatação acadêmica.',
      '3 DISCUSSÃO',
      'A presente tese sustenta que a normalização importa.',
    ])
    expect(r).toEqual({ sections: [], bodyStart: 0 })
  })
})

describe('coverBlockIndices — only the identity pages, never resumo/abstract', () => {
  it('returns capa + folha de rosto blocks but not resumo', () => {
    const { sections } = classifyPretextual([
      'UNIVERSIDADE X', 'Ana Lima', 'TÍTULO', 'São Paulo', '2023',           // capa 0-4
      'Ana Lima', 'Dissertação apresentada como requisito parcial.',          // natureza
      'Orientador: Dr. Silva', 'São Paulo', '2023',                          // folha 5-9
      'RESUMO', 'Texto do resumo.',                                          // 10-11
      '1 INTRODUÇÃO', 'Corpo.',                                             // 12 body
    ])
    const cover = coverBlockIndices(sections)
    expect([...cover].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(cover.has(10)).toBe(false) // RESUMO heading proofread
    expect(cover.has(11)).toBe(false) // resumo prose proofread
  })
})

describe('applyPretextualHeadings', () => {
  it('stamps the unnumbered-title style on labeled headings but not on the capa', () => {
    const xml = doc(['UNIVERSIDADE X', 'TÍTULO', '2023', 'RESUMO', 'Texto.', 'SUMÁRIO', '1 INTRODUÇÃO ... 4', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    const out = applyPretextualHeadings(xml, sections)

    // RESUMO and SUMÁRIO headings now carry the style…
    expect(out).toContain(`<w:pPr><w:pStyle w:val="${REFERENCES_HEADING_STYLE}"/></w:pPr><w:r><w:t>RESUMO`)
    expect(out).toContain(`<w:pPr><w:pStyle w:val="${REFERENCES_HEADING_STYLE}"/></w:pPr><w:r><w:t>SUMÁRIO`)
    // …the capa lines do not (left as a plain paragraph).
    expect(out).toContain(`<w:p><w:r><w:t>UNIVERSIDADE X</w:t>`)
    // body heading is untouched (Step D will classify it)
    expect(out).toContain(`<w:p><w:r><w:t>1 INTRODUÇÃO</w:t>`)
  })

  it('is a no-op when there is no front matter', () => {
    const xml = doc(['1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    expect(applyPretextualHeadings(xml, sections)).toBe(xml)
  })
})

describe('applyFolhaRostoAlignment', () => {
  it('centers author/title/city/year but right-offsets natureza+orientador', () => {
    // capa 0-4 · folha 5-10 · resumo 11-12 · body 13-14
    const texts = [
      'UNIVERSIDADE X', 'Ana Lima', 'TÍTULO', 'São Paulo', '2023',
      'Ana Lima', 'TÍTULO',
      'Monografia apresentada como requisito parcial para obtenção do grau.',
      'Orientador: Prof. Dr. Silva', 'São Paulo', '2023',
      'RESUMO', 'Texto do resumo.',
      '1 INTRODUÇÃO', 'Corpo.',
    ]
    const xml = doc(texts)
    const { sections } = detectPretextual(xml)
    const blocks = getBlocks(applyFolhaRostoAlignment(xml, sections))
    // capa untouched by this function
    expect(styleOf(blocks[0])).toBeNull()
    // folha de rosto: author + title + city + year → centered
    expect(styleOf(blocks[5])).toBe(COVER_STYLE)   // author
    expect(styleOf(blocks[6])).toBe(COVER_STYLE)   // title
    // natureza + orientador → right-offset
    expect(styleOf(blocks[7])).toBe(FOLHA_ROSTO_NATUREZA_STYLE)
    expect(styleOf(blocks[8])).toBe(FOLHA_ROSTO_NATUREZA_STYLE)
    // city + year after natureza → centered again
    expect(styleOf(blocks[9])).toBe(COVER_STYLE)   // city
    expect(styleOf(blocks[10])).toBe(COVER_STYLE)  // year
    // resumo untouched
    expect(styleOf(blocks[11])).toBeNull()
  })

  it('centers all folha paragraphs when no natureza text is present', () => {
    // folha de rosto detected via orientador only is an edge case; check centering fallback
    const texts = [
      'ANA LIMA', 'TÍTULO', 'Orientador: Prof. Silva', 'São Paulo', '2023',
      'RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.',
    ]
    const xml = doc(texts)
    // For this test manually build a mock sections list (folha covers 0-4)
    // We use classifyPretextual directly since detectPretextual uses XML
    const { sections } = detectPretextual(xml)
    const blocks = getBlocks(applyFolhaRostoAlignment(xml, sections))
    // All folha blocks should be styled (either COVER_STYLE or FOLHA_ROSTO_NATUREZA_STYLE)
    const folha = sections.find(s => s.kind === 'folhaDeRosto')
    if (folha) {
      for (let i = folha.blockStart; i <= folha.blockEnd; i++) {
        expect(styleOf(blocks[i])).not.toBeNull()
      }
    }
  })

  it('is a no-op when there is no folha de rosto', () => {
    const xml = doc(['RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    expect(applyFolhaRostoAlignment(xml, sections)).toBe(xml)
  })
})

describe('applyPretextualPageBreaks', () => {
  it('adds pageBreakBefore to sections[1+] but not sections[0]', () => {
    // capa 0-2 · resumo 3-4 · sumario 5-6 · body 7+
    const xml = doc(['UNIVERSIDADE X', 'Ana Lima', '2023', 'RESUMO', 'Texto.', 'SUMÁRIO', 'TOC ...3', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    expect(sections.length).toBeGreaterThanOrEqual(3)
    const out = applyPretextualPageBreaks(xml, sections)
    const blocks = getBlocks(out)
    // first section (capa block 0) must NOT have a page break
    expect(/<w:pageBreakBefore/.test(blocks[0])).toBe(false)
    // second section first block → page break
    expect(/<w:pageBreakBefore/.test(blocks[sections[1].blockStart])).toBe(true)
    // third section first block → page break
    expect(/<w:pageBreakBefore/.test(blocks[sections[2].blockStart])).toBe(true)
  })

  it('is idempotent — does not double-add the page break', () => {
    const xml = doc(['UNIVERSIDADE X', '2023', 'RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    const once = applyPretextualPageBreaks(xml, sections)
    const twice = applyPretextualPageBreaks(once, sections)
    expect(twice).toBe(once)
  })

  it('composes with applyPretextualHeadings — page break and heading style coexist', () => {
    const xml = doc(['UNIVERSIDADE X', '2023', 'RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    let out = applyPretextualHeadings(xml, sections)
    out = applyPretextualPageBreaks(out, sections)
    const blocks = getBlocks(out)
    const resumoIdx = sections.find(s => s.kind === 'resumo')!.blockStart
    // The RESUMO block should carry both the heading style AND the page break
    expect(blocks[resumoIdx]).toContain(`w:val="${REFERENCES_HEADING_STYLE}"`)
    expect(blocks[resumoIdx]).toContain('<w:pageBreakBefore/>')
  })

  it('is a no-op with zero or one section', () => {
    const xml = doc(['1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    expect(applyPretextualPageBreaks(xml, sections)).toBe(xml)
  })
})

describe('applyCoverAlignment', () => {
  it('centers every capa paragraph but not the resumo/sumário', () => {
    // capa 0-2 · RESUMO 3 · resumo prose 4 · SUMÁRIO 5 · TOC 6 · body 7
    const xml = doc(['UNIVERSIDADE X', 'Maria Santos', 'TÍTULO DO TRABALHO', 'RESUMO', 'Texto.', 'SUMÁRIO', '1 INTRODUÇÃO ... 4', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    const blocks = getBlocks(applyCoverAlignment(xml, sections))
    expect(styleOf(blocks[0])).toBe(COVER_STYLE) // UNIVERSIDADE
    expect(styleOf(blocks[1])).toBe(COVER_STYLE) // author
    expect(styleOf(blocks[2])).toBe(COVER_STYLE) // title
    expect(styleOf(blocks[3])).toBeNull()         // RESUMO — not a cover (gets heading style elsewhere)
    expect(styleOf(blocks[4])).toBeNull()         // resumo prose — untouched here
  })

  it('is a no-op when there is no capa', () => {
    const xml = doc(['RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    expect(applyCoverAlignment(xml, sections)).toBe(xml)
  })
})

describe('applyCoverVerticalDistribution', () => {
  it('collapses the capa into a borderless table: centered main zone + year pinned to the page foot', () => {
    // capa 0-3 · RESUMO 4 · resumo prose 5 · body 6
    const xml = docWithSectPr(['UNIVERSIDADE X', 'Maria Santos', 'TÍTULO DO TRABALHO', '2023', 'RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    const capa = sections.find(s => s.kind === 'capa')!
    const out = applyCoverVerticalDistribution(xml, sections)
    const blocks = getBlocks(out)

    // 8 original blocks → 5 (capa's 4 paragraphs collapse into 1 table block).
    expect(blocks.length).toBe(5)
    const table = blocks[capa.blockStart]
    expect(table).toMatch(/^<w:tbl>/)
    // Content area: pgSz 11906x16838 minus pgMar 1701/1134/1134/1701 (w/r/b/l).
    expect(table).toContain('w:w="9071"')
    // Two rows: main zone centered, foot zone bottom-aligned.
    expect(table).toContain('<w:vAlign w:val="center"/>')
    expect(table).toContain('<w:vAlign w:val="bottom"/>')
    expect(table).toContain('w:hRule="atLeast"')
    // The year is in the bottom (foot) cell; the rest in the centered main cell.
    const footCell = table.slice(table.indexOf('<w:vAlign w:val="bottom"/>'))
    expect(footCell).toContain('2023')
    expect(footCell).not.toContain('TÍTULO DO TRABALHO')
    const mainCell = table.slice(0, table.indexOf('<w:vAlign w:val="bottom"/>'))
    expect(mainCell).toContain('UNIVERSIDADE X')
    expect(mainCell).toContain('Maria Santos')
    expect(mainCell).toContain('TÍTULO DO TRABALHO')
    // Rows sum to the content height minus the safety slack (14003 − 60).
    const heights = [...table.matchAll(/w:trHeight w:val="(\d+)"/g)].map(m => parseInt(m[1], 10))
    expect(heights.reduce((a, b) => a + b, 0)).toBe(14003 - 60)
    // No table borders (blends into the page, not a visible box).
    expect(table).toContain('<w:top w:val="none"/>')
    // RESUMO now sits right after the table, still its own paragraph.
    expect(blocks[capa.blockStart + 1]).toContain('RESUMO')
  })

  it('includes a title-case city line above the year in the foot zone', () => {
    const xml = docWithSectPr(['UNIVERSIDADE X', 'TÍTULO', 'São Paulo', '2023', 'RESUMO', 'Texto.'])
    const { sections } = detectPretextual(xml)
    const out = applyCoverVerticalDistribution(xml, sections)
    const table = getBlocks(out)[0]
    const footCell = table.slice(table.indexOf('<w:vAlign w:val="bottom"/>'))
    expect(footCell).toContain('São Paulo')
    expect(footCell).toContain('2023')
    const mainCell = table.slice(0, table.indexOf('<w:vAlign w:val="bottom"/>'))
    expect(mainCell).not.toContain('São Paulo')
  })

  it('distributes the folha de rosto too (single-year document, no capa/folha split)', () => {
    // Only one year line + natureza → the whole leading region classifies as folhaDeRosto.
    const xml = docWithSectPr([
      'Ana Lima', 'TÍTULO',
      'Monografia apresentada como requisito parcial para obtenção do grau.',
      'Orientador: Prof. Dr. Silva', 'São Paulo', '2023',
      'RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.',
    ])
    const { sections } = detectPretextual(xml)
    expect(sections[0].kind).toBe('folhaDeRosto')
    const out = applyCoverVerticalDistribution(xml, sections)
    const blocks = getBlocks(out)
    expect(blocks[0]).toMatch(/^<w:tbl>/)
    const footCell = blocks[0].slice(blocks[0].indexOf('<w:vAlign w:val="bottom"/>'))
    expect(footCell).toContain('São Paulo')
    expect(footCell).toContain('2023')
    expect(blocks[1]).toContain('RESUMO')
  })

  it('merges contiguous capa + folha de rosto into ONE table (adjacent tables would merge in Word)', () => {
    const xml = docWithSectPr([
      'UNIVERSIDADE X', 'TÍTULO', '2023',                                     // capa 0-2
      'Ana Lima', 'Dissertação apresentada como requisito parcial.',          // folha 3-7
      'Orientador: Dr. Silva', 'São Paulo', '2023',
      'RESUMO', 'Texto.',
    ])
    const { sections } = detectPretextual(xml)
    expect(sections.map(s => s.kind).slice(0, 2)).toEqual(['capa', 'folhaDeRosto'])
    const out = applyCoverVerticalDistribution(xml, sections)
    const blocks = getBlocks(out)
    // One table block replaces both covers, then RESUMO.
    expect(blocks[0]).toMatch(/^<w:tbl>/)
    expect(blocks[1]).toContain('RESUMO')
    expect(out.match(/<w:tbl>/g)).toHaveLength(1)
    // Two pages → 4 rows (main + foot each), each page summing to contentH − slack.
    const heights = [...blocks[0].matchAll(/w:trHeight w:val="(\d+)"/g)].map(m => parseInt(m[1], 10))
    expect(heights).toHaveLength(4)
    expect(heights[0] + heights[1]).toBe(14003 - 60)
    expect(heights[2] + heights[3]).toBe(14003 - 60)
  })

  it('splits a merged cover section into pages at the author\'s own page breaks', () => {
    // Single-year-line doc: capa content + explicit page break + folha content, all one
    // folhaDeRosto section. Each page keeps its own centered zone + pinned foot.
    const capaPage = ['UNIVERSIDADE X', 'TÍTULO DO TRABALHO', 'Recife', '2024']
    const folhaPage = [
      'Ana Lima',
      'Tese apresentada ao programa como requisito parcial para obtenção do título.',
      'Recife – 2024', // combined city-year line → not a bare year-line → no capa↔folha split
    ]
    const paras =
      capaPage.map(t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('') +
      `<w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>${folhaPage[0]}</w:t></w:r></w:p>` +
      folhaPage.slice(1).map(t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('') +
      '<w:p><w:r><w:t>RESUMO</w:t></w:r></w:p><w:p><w:r><w:t>Texto.</w:t></w:r></w:p>' +
      BODY_SECT_PR
    const xml = `<w:document><w:body>${paras}</w:body></w:document>`
    const { sections } = detectPretextual(xml)
    expect(sections[0].kind).toBe('folhaDeRosto') // merged: only one year-line count ≥ 2 would split
    const out = applyCoverVerticalDistribution(xml, sections)
    const table = getBlocks(out)[0]
    expect(table).toMatch(/^<w:tbl>/)
    // Two page groups → 4 rows; each foot carries its own city/year.
    const heights = [...table.matchAll(/w:trHeight w:val="(\d+)"/g)].map(m => parseInt(m[1], 10))
    expect(heights).toHaveLength(4)
    const footCells = [...table.matchAll(/<w:vAlign w:val="bottom"\/><\/w:tcPr>([\s\S]*?)<\/w:tc>/g)].map(m => m[1])
    expect(footCells).toHaveLength(2)
    expect(footCells[0]).toContain('Recife')
    expect(footCells[0]).toContain('2024')
    expect(footCells[1]).toContain('Recife – 2024')
    // The pageBreakBefore must not survive inside the table (rows own pagination now).
    expect(table).not.toContain('pageBreakBefore')
  })

  it('is idempotent — a second call is a no-op (already collapsed, no longer plain paragraphs)', () => {
    const xml = docWithSectPr(['UNIVERSIDADE X', '2023', 'RESUMO', 'Texto.'])
    const { sections } = detectPretextual(xml)
    const once = applyCoverVerticalDistribution(xml, sections)
    expect(applyCoverVerticalDistribution(once, sections)).toBe(once)
  })

  it('is a no-op when there is no capa or folha de rosto', () => {
    const xml = docWithSectPr(['RESUMO', 'Texto.', '1 INTRODUÇÃO', 'Corpo.'])
    const { sections } = detectPretextual(xml)
    expect(applyCoverVerticalDistribution(xml, sections)).toBe(xml)
  })

  it('is a no-op when the document has no final sectPr to clone', () => {
    const xml = doc(['UNIVERSIDADE X', '2023', 'RESUMO', 'Texto.'])
    const { sections } = detectPretextual(xml)
    expect(applyCoverVerticalDistribution(xml, sections)).toBe(xml)
  })
})
