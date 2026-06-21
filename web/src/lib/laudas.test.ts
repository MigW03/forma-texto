import { describe, it, expect } from 'vitest'
import { computeLaudas, laudaBlockSet } from './laudas'

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

describe('laudaBlockSet — appendix kept only when its laudas are selected', () => {
  it('keeps only the selected laudas, appendix included', () => {
    const laudas = computeLaudas([words(300), words(300)])
    const keep = laudaBlockSet(laudas, [1])
    expect([...keep].sort()).toEqual([0])
  })
})
