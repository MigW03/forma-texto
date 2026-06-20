import { describe, it, expect } from 'vitest'
import { locateAppendixStart, looksLikeAppendixHeading } from './postTextual'

const wp = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const doc = (...paras: string[]) =>
  `<?xml version="1.0"?><w:document><w:body>${paras.join('')}</w:body></w:document>`

describe('looksLikeAppendixHeading', () => {
  it('matches uppercase APÊNDICE / ANEXO headings (with or without a title)', () => {
    expect(looksLikeAppendixHeading('APÊNDICE')).toBe(true)
    expect(looksLikeAppendixHeading('APÊNDICE A — Questionário')).toBe(true)
    expect(looksLikeAppendixHeading('ANEXO')).toBe(true)
    expect(looksLikeAppendixHeading('ANEXOS')).toBe(true)
    expect(looksLikeAppendixHeading('ANEXO B - Mapa da região')).toBe(true)
    expect(looksLikeAppendixHeading('APENDICE A')).toBe(true) // no accent
  })

  it('rejects in-body lowercase mentions', () => {
    expect(looksLikeAppendixHeading('ver o anexo A para detalhes')).toBe(false)
    expect(looksLikeAppendixHeading('como mostra o apêndice')).toBe(false)
  })

  it('rejects unrelated headings', () => {
    expect(looksLikeAppendixHeading('REFERÊNCIAS')).toBe(false)
    expect(looksLikeAppendixHeading('CONCLUSÃO')).toBe(false)
    expect(looksLikeAppendixHeading('')).toBe(false)
  })
})

describe('locateAppendixStart', () => {
  it('returns the block index of the first appendix/annex heading', () => {
    const d = doc(
      wp('Introdução'),
      wp('Desenvolvimento'),
      wp('REFERÊNCIAS'),
      wp('SILVA, J. Título. 2020.'),
      wp('APÊNDICE A — Questionário'),
      wp('Pergunta 1'),
      wp('ANEXO A — Mapa'),
    )
    expect(locateAppendixStart(d)).toBe(4)
  })

  it('returns the annex index when there is no appendix', () => {
    const d = doc(wp('Texto'), wp('Mais texto'), wp('ANEXO A — Formulário'), wp('conteúdo'))
    expect(locateAppendixStart(d)).toBe(2)
  })

  it('returns null when there is no appendix or annex', () => {
    const d = doc(wp('Introdução'), wp('REFERÊNCIAS'), wp('SILVA, J. 2020.'))
    expect(locateAppendixStart(d)).toBeNull()
  })

  it('is not fooled by a body mention of the word', () => {
    const d = doc(wp('O anexo A traz os dados completos.'), wp('Conclusão'))
    expect(locateAppendixStart(d)).toBeNull()
  })
})
