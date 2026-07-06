import { describe, it, expect } from 'vitest'
import { detectPretextual } from './pretextual'

const b = (text: string) => ({ text })

// A realistic ABNT front matter: capa → folha de rosto → resumo → abstract →
// sumário (with TOC entries) → body. The real "1 INTRODUÇÃO" heading must win over
// the identically-named TOC entry above it.
const fullFrontMatter = [
  b('UNIVERSIDADE FEDERAL DE MINAS GERAIS'), // 0
  b('João da Silva'),                        // 1
  b('UM ESTUDO SOBRE FORMATAÇÃO'),           // 2
  b('Belo Horizonte'),                       // 3
  b('2024'),                                 // 4  capa year
  b('João da Silva'),                        // 5
  b('UM ESTUDO SOBRE FORMATAÇÃO'),           // 6
  b('Dissertação apresentada ao Programa como requisito parcial para obtenção do título de Mestre.'), // 7
  b('Orientador: Prof. Dr. Carlos Souza'),   // 8
  b('Belo Horizonte'),                       // 9
  b('2024'),                                 // 10 folha de rosto year
  b('RESUMO'),                               // 11
  b('Este trabalho investiga a formatação...'), // 12
  b('Palavras-chave: ABNT. Formatação.'),    // 13
  b('ABSTRACT'),                             // 14
  b('This work investigates formatting...'), // 15
  b('Keywords: ABNT. Formatting.'),          // 16
  b('SUMÁRIO'),                              // 17
  b('1 INTRODUÇÃO........................5'), // 18 TOC entry
  b('2 REFERENCIAL TEÓRICO............8'),    // 19 TOC entry
  b('1 INTRODUÇÃO'),                          // 20 real body heading
  b('A formatação de trabalhos é um desafio.'), // 21
]

describe('detectPretextual — full front matter', () => {
  const r = detectPretextual(fullFrontMatter)

  it('places bodyStart at the real heading, not the TOC entry', () => {
    expect(r.bodyStart).toBe(20)
  })

  it('classifies every section with the right ranges', () => {
    expect(r.sections).toEqual([
      { kind: 'capa', blockStart: 0, blockEnd: 4 },
      { kind: 'folhaDeRosto', blockStart: 5, blockEnd: 10 },
      { kind: 'resumo', blockStart: 11, blockEnd: 13 },
      { kind: 'abstract', blockStart: 14, blockEnd: 16 },
      { kind: 'sumario', blockStart: 17, blockEnd: 19 }, // TOC entries stay inside
    ])
  })
})

describe('detectPretextual — edge cases', () => {
  it('detects nothing in a body-only document (preserves current billing)', () => {
    const r = detectPretextual([
      b('1 INTRODUÇÃO'),
      b('Texto corrido sem elementos pré-textuais.'),
      b('2 DESENVOLVIMENTO'),
      b('Mais texto.'),
    ])
    expect(r.bodyStart).toBe(0)
    expect(r.sections).toHaveLength(0)
  })

  it('does not flag body prose that merely mentions a thesis-type word', () => {
    // "dissertação"/"tese" in running text must NOT trigger folha-de-rosto detection,
    // or real chapters would be wrongly excluded from laudas + formatting.
    const r = detectPretextual([
      b('1 INTRODUÇÃO'),
      b('Nesta dissertação analisamos a formatação de documentos acadêmicos.'),
      b('3 DISCUSSÃO'),
      b('A presente tese sustenta que a normalização importa.'),
    ])
    expect(r).toEqual({ sections: [], bodyStart: 0 })
  })

  it('treats a leading region as capa when there is no natureza note', () => {
    const r = detectPretextual([
      b('UNIVERSIDADE X'), b('Maria Santos'), b('TÍTULO'), b('São Paulo'), b('2023'),
      b('RESUMO'), b('Resumo do trabalho.'),
      b('1 INTRODUÇÃO'), b('Corpo.'),
    ])
    expect(r.bodyStart).toBe(7)
    expect(r.sections).toEqual([
      { kind: 'capa', blockStart: 0, blockEnd: 4 },
      { kind: 'resumo', blockStart: 5, blockEnd: 6 },
    ])
  })

  it('detects folha de rosto from the natureza note without a year split', () => {
    const r = detectPretextual([
      b('Ana Lima'),
      b('TÍTULO DO TRABALHO'),
      b('Monografia apresentada como requisito parcial para obtenção do grau de Bacharel.'),
      b('SUMÁRIO'),
      b('1 INTRODUÇÃO ... 4'),
      b('1 INTRODUÇÃO'),
      b('Corpo do texto.'),
    ])
    expect(r.bodyStart).toBe(5)
    expect(r.sections[0]).toEqual({ kind: 'folhaDeRosto', blockStart: 0, blockEnd: 2 })
    expect(r.sections.at(-1)?.kind).toBe('sumario')
  })

  it('matches list sections and ignores in-body mentions of a label word', () => {
    const r = detectPretextual([
      b('LISTA DE TABELAS'),
      b('Tabela 1 — Resultados ... 7'),
      b('SUMÁRIO'),
      b('1 INTRODUÇÃO ... 9'),
      b('1 INTRODUÇÃO'),
      b('No resumo do capítulo anterior discutimos os métodos.'), // "resumo" mid-sentence: not a label
    ])
    expect(r.sections.map(s => s.kind)).toEqual(['listaTabelas', 'sumario'])
    expect(r.bodyStart).toBe(4)
  })
})
