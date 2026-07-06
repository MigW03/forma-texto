import { describe, it, expect } from 'vitest'
import { buildSumario } from './sumario'
import { findSumarioEntries, assignEntryPages, applySumarioPageNumbers } from './sumarioPagination'
import { detectPretextual } from './preTextual'
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

/** A doc whose sumário was rebuilt by buildSumario (the real entry shape). */
function docWithSumario(): string {
  const raw = DOC(
    para('SUMÁRIO', 'ReferencesHeading') +
    para('old entry') +
    h1('1 INTRODUÇÃO') +
    para('Texto do corpo.') +
    h2('1.1 Contexto histórico') +
    h1('2 MÉTODOS') +
    para('Mais texto.'),
  )
  return buildSumario(raw, detectPretextual(raw))
}

describe('findSumarioEntries', () => {
  it('finds the rebuilt entries right after the label, with clean titles', () => {
    const entries = findSumarioEntries(docWithSumario())
    expect(entries.map(e => e.text)).toEqual(['1 INTRODUÇÃO', '1.1 Contexto histórico', '2 MÉTODOS'])
    expect(entries.map(e => e.index)).toEqual([1, 2, 3])
  })

  it('returns [] when there is no sumário section', () => {
    expect(findSumarioEntries(DOC(h1('1 INTRO') + para('corpo')))).toEqual([])
  })

  it('does not leak a previously stamped page number into the title', () => {
    const once = applySumarioPageNumbers(docWithSumario(), ['SUMÁRIO 1 INTRODUÇÃO 1.1 CONTEXTO HISTÓRICO 2 MÉTODOS', '1 INTRODUÇÃO texto', '', 'corpo 2 MÉTODOS'])
    const entries = findSumarioEntries(once.documentXml)
    expect(entries.map(e => e.text)).toEqual(['1 INTRODUÇÃO', '1.1 Contexto histórico', '2 MÉTODOS'])
  })
})

describe('assignEntryPages', () => {
  const entries = ['1 INTRODUÇÃO', '1.1 Contexto histórico', '2 MÉTODOS']

  it('skips the sumário page and maps entries to their body pages, accent/case-insensitively', () => {
    const pages = [
      'UNIVERSIDADE X capa 2024',                                       // 1 capa
      'SUMARIO 1 INTRODUCAO 1.1 CONTEXTO HISTORICO 2 METODOS',          // 2 TOC (rendered caps, no accents)
      '1 INTRODUÇÃO Este é o texto do corpo com bastante prosa ao redor da introdução do trabalho.', // 3
      '1.1 Contexto histórico mais prosa aqui sobre o contexto do problema e da literatura.',        // 4
      'texto intermediário sem heading nenhum apenas prosa corrida',    // 5
      '2 MÉTODOS a metodologia é descrita nesta seção em detalhe.',     // 6
    ]
    expect(assignEntryPages(entries, pages)).toEqual([3, 4, 6])
  })

  it('skips multi-page sumários (contiguous TOC-looking pages)', () => {
    const pages = [
      'SUMARIO 1 INTRODUCAO 1.1 CONTEXTO HISTORICO',                    // 1 TOC page 1
      '2 METODOS 1 INTRODUCAO 1.1 CONTEXTO HISTORICO',                  // 2 TOC page 2 (continuation)
      '1 INTRODUÇÃO prosa longa o suficiente para não parecer um sumário de jeito nenhum aqui.', // 3
      '2 MÉTODOS mais prosa longa também para diluir a densidade das entradas na página.',       // 4
    ]
    expect(assignEntryPages(entries, pages)).toEqual([3, null, 4]) // 1.1 never appears in the body
  })

  it('resolves a repeated heading title monotonically (each to its own occurrence)', () => {
    const twice = ['ANEXO', 'ANEXO']
    const pages = [
      'SUMARIO ANEXO ANEXO',
      'ANEXO primeiro, com texto por perto para diluir a página.',
      'miolo sem nada',
      'ANEXO segundo, também com texto ao redor para diluir a página.',
    ]
    expect(assignEntryPages(twice, pages)).toEqual([2, 4])
  })

  it('returns null (blank number) for a heading never found — never a guess', () => {
    const pages = ['SUMARIO 1 INTRODUCAO 2 METODOS', '1 INTRODUÇÃO prosa aqui nesta página de corpo.']
    expect(assignEntryPages(['1 INTRODUÇÃO', '2 MÉTODOS'], pages)).toEqual([2, null])
  })
})

describe('applySumarioPageNumbers', () => {
  const PAGES = [
    'capa UNIVERSIDADE 2024',
    'SUMARIO 1 INTRODUCAO 1.1 CONTEXTO HISTORICO 2 METODOS',
    '1 INTRODUÇÃO Este é o corpo do texto com prosa suficiente ao redor do título.',
    '1.1 Contexto histórico prosa do contexto se estende por esta página inteira.',
    '2 MÉTODOS descrição completa da metodologia aplicada neste trabalho acadêmico.',
  ]

  it('stamps the physical page number after each entry tab', () => {
    const { documentXml, assigned, total } = applySumarioPageNumbers(docWithSumario(), PAGES)
    expect({ assigned, total }).toEqual({ assigned: 3, total: 3 })
    const blocks = getBlocks(documentXml)
    expect(blocks[1]).toContain('<w:r><w:tab/></w:r><w:r><w:t>3</w:t></w:r></w:p>')
    expect(blocks[2]).toContain('<w:t>4</w:t>')
    expect(blocks[3]).toContain('<w:t>5</w:t>')
    // blockText drops the standalone tab run, so title and number concatenate here;
    // in Word/PDF the tab separates them visually.
    expect(blockText(blocks[1])).toBe('1 INTRODUÇÃO3')
  })

  it('is idempotent — a re-run replaces the number instead of stacking a second one', () => {
    const once = applySumarioPageNumbers(docWithSumario(), PAGES).documentXml
    const twice = applySumarioPageNumbers(once, PAGES).documentXml
    expect(twice).toBe(once)
  })

  it('leaves not-found entries blank and the rest stamped', () => {
    const pages = ['SUMARIO 1 INTRODUCAO 1.1 CONTEXTO HISTORICO 2 METODOS', '1 INTRODUÇÃO prosa nesta página de corpo do trabalho.']
    const { documentXml, assigned, total } = applySumarioPageNumbers(docWithSumario(), pages)
    expect({ assigned, total }).toEqual({ assigned: 1, total: 3 })
    const blocks = getBlocks(documentXml)
    expect(blocks[1]).toContain('<w:t>2</w:t>')
    expect(blocks[2]).toContain('<w:r><w:tab/></w:r></w:p>') // blank number kept
  })

  it('no sumário → unchanged', () => {
    const doc = DOC(h1('1 INTRO') + para('corpo'))
    expect(applySumarioPageNumbers(doc, PAGES).documentXml).toBe(doc)
  })
})
