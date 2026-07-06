import { describe, it, expect } from 'vitest'
import { computeLaudas, laudaBlockSet, analyzeDocument, uploadKeepSet } from './laudas'

// Each block ~300 words so one block = one lauda, making boundaries easy to assert.
const words = (n: number) => ({ text: Array(n).fill('palavra').join(' ') })
const heading = (text: string) => ({ text })

describe('computeLaudas — appendix counted like the rest', () => {
  it('counts appendix/annex blocks as billable laudas', () => {
    const blocks = [words(300), words(300), heading('ANEXO A — Mapa'), words(300), words(300)]
    const laudas = computeLaudas(blocks)
    // every block is billable now, including the annex section
    expect(laudas).toHaveLength(4)
    expect(laudas[laudas.length - 1].blockEnd).toBe(4)
  })

  it('counts every block when there is no appendix', () => {
    const laudas = computeLaudas([words(300), words(300), words(300)])
    expect(laudas).toHaveLength(3)
  })
})

describe('computeLaudas — bodyStart excludes pré-textual blocks', () => {
  it('skips the pré-textual region and keeps absolute block indices', () => {
    // blocks 0-1 are pré-textual (capa/resumo), body starts at block 2
    const blocks = [heading('CAPA'), heading('RESUMO'), words(300), words(300)]
    const laudas = computeLaudas(blocks, 300, 2)
    expect(laudas).toHaveLength(2)
    expect(laudas[0].blockStart).toBe(2) // absolute index, not 0
    expect(laudas[1].blockEnd).toBe(3)
  })

  it('returns no laudas when the whole document is pré-textual', () => {
    const blocks = [heading('CAPA'), heading('RESUMO')]
    expect(computeLaudas(blocks, 300, 2)).toHaveLength(0)
  })
})

describe('analyzeDocument + uploadKeepSet — pré-textuais excluded but always shipped', () => {
  // capa (0) · resumo label (1) · resumo text (2) · body heading (3) · body (4-5)
  const doc = [
    heading('UNIVERSIDADE X'),
    heading('RESUMO'),
    heading('Resumo do trabalho com algum texto introdutório.'),
    heading('1 INTRODUÇÃO'),
    words(300),
    words(300),
  ]

  it('excludes the pré-textual region from laudas', () => {
    const { laudas, bodyStart } = analyzeDocument(doc)
    expect(bodyStart).toBe(3)
    expect(laudas).toHaveLength(2)
    expect(laudas[0].blockStart).toBe(3)
  })

  it('always keeps pré-textual blocks even when only a later lauda is selected', () => {
    const keep = uploadKeepSet(doc, [2]) // second body lauda only
    // pré-textuais 0-2 retained + lauda 2 block (5); lauda 1 block (4) dropped
    expect([...keep].sort((a, b) => a - b)).toEqual([0, 1, 2, 5])
  })
})

describe('laudaBlockSet — appendix kept only when its laudas are selected', () => {
  it('keeps only the selected laudas, appendix included', () => {
    const laudas = computeLaudas([words(300), words(300)])
    const keep = laudaBlockSet(laudas, [1])
    expect([...keep].sort()).toEqual([0])
  })
})
