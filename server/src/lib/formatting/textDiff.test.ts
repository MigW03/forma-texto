import { describe, it, expect } from 'vitest'
import { diff } from './textDiff'

/** Apply hunks back to `a` to confirm they reconstruct `b` (the diff is correct/complete). */
function applyHunks(a: string, b: string): string {
  const hunks = diff(a, b)
  let out = ''
  let cursor = 0
  for (const h of hunks) {
    out += a.slice(cursor, h.aStart) + h.replacement
    cursor = h.aEnd
  }
  out += a.slice(cursor)
  return out
}

describe('diff', () => {
  it('returns no hunks for identical strings', () => {
    expect(diff('hello world', 'hello world')).toEqual([])
  })

  it('confines a single-word edit to that word, leaving the rest untouched', () => {
    const a = 'teh quick fox'
    const hunks = diff(a, 'the quick fox')
    expect(applyHunks(a, 'the quick fox')).toBe('the quick fox')
    // Every edit stays within the first word; " quick fox" is never touched.
    expect(Math.max(...hunks.map(h => h.aEnd))).toBeLessThanOrEqual(3)
  })

  it('keeps the equal middle out of every hunk when two edits are far apart', () => {
    const a = 'teh quick brown fxo'
    const b = 'the quick brown fox'
    const hunks = diff(a, b)
    expect(applyHunks(a, b)).toBe(b)
    // The anti-goal: no single hunk may span the unchanged "quick brown" middle.
    const mid = a.indexOf('quick')
    expect(hunks.every(h => h.aEnd <= mid || h.aStart >= mid + 'quick brown'.length)).toBe(true)
  })

  it('handles a pure insertion', () => {
    const a = 'casa cachorro'
    const b = 'casa e cachorro'
    const hunks = diff(a, b)
    expect(hunks).toHaveLength(1)
    expect(hunks[0].aStart).toBe(hunks[0].aEnd) // zero-width = insertion
    expect(applyHunks(a, b)).toBe(b)
  })

  it('handles a pure deletion', () => {
    const a = 'um  espaço'
    const b = 'um espaço'
    expect(applyHunks(a, b)).toBe(b)
  })

  it('handles full replacement when nothing is common', () => {
    const hunks = diff('abc', 'xyz')
    expect(hunks).toEqual([{ aStart: 0, aEnd: 3, replacement: 'xyz' }])
  })

  it('handles insertion at the very start and end', () => {
    expect(applyHunks('meio', '(meio)')).toBe('(meio)')
  })

  it('reconstructs a multi-edit paragraph', () => {
    const a = 'O aluno fizeram a prova e foi aprovado no dia seginte.'
    const b = 'O aluno fez a prova e foi aprovado no dia seguinte.'
    expect(applyHunks(a, b)).toBe(b)
  })
})
