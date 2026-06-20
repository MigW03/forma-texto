import { describe, it, expect } from 'vitest'
import { computeLaudas, laudaBlockSet, findAppendixBlock } from './laudas'

// Each block ~300 words so one block = one lauda, making boundaries easy to assert.
const words = (n: number) => ({ text: Array(n).fill('palavra').join(' ') })
const heading = (text: string) => ({ text })

describe('findAppendixBlock', () => {
  it('finds the first uppercase appendix/annex heading', () => {
    const blocks = [words(300), heading('APÊNDICE A — Questionário'), words(300)]
    expect(findAppendixBlock(blocks)).toBe(1)
  })

  it('ignores a lowercase in-body mention', () => {
    expect(findAppendixBlock([{ text: 'ver o anexo A' }, words(300)])).toBeNull()
  })
})

describe('computeLaudas — appendix excluded from billing', () => {
  it('does not count appendix/annex blocks as laudas', () => {
    const blocks = [words(300), words(300), heading('ANEXO A — Mapa'), words(300), words(300)]
    const laudas = computeLaudas(blocks)
    // only the 2 body blocks before the annex are billable
    expect(laudas).toHaveLength(2)
    expect(laudas[laudas.length - 1].blockEnd).toBe(1) // stops before the annex
  })

  it('counts every block when there is no appendix', () => {
    const laudas = computeLaudas([words(300), words(300), words(300)])
    expect(laudas).toHaveLength(3)
  })
})

describe('laudaBlockSet — appendix always kept on slice', () => {
  it('keeps the appendix range even when it is not a selected lauda', () => {
    const blocks = [words(300), words(300), heading('APÊNDICE A'), words(300)]
    const laudas = computeLaudas(blocks) // 2 laudas (blocks 0,1)
    const keep = laudaBlockSet(laudas, [1], blocks) // user selects only lauda 1
    expect(keep.has(0)).toBe(true) // selected lauda
    expect(keep.has(1)).toBe(false) // unselected lauda dropped
    expect(keep.has(2)).toBe(true) // appendix heading kept
    expect(keep.has(3)).toBe(true) // appendix body kept
  })

  it('keeps only selected laudas when no block list is passed (back-compat)', () => {
    const laudas = computeLaudas([words(300), words(300)])
    const keep = laudaBlockSet(laudas, [1])
    expect([...keep].sort()).toEqual([0])
  })
})
