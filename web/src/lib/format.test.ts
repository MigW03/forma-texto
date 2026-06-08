import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatPageRanges, toTimeAgo } from './format'

describe('formatPageRanges', () => {
  it('collapses consecutive pages into ranges', () => {
    expect(formatPageRanges([1, 2, 3, 5, 8, 9])).toBe('1–3, 5, 8–9')
  })

  it('sorts and de-duplicates the input', () => {
    expect(formatPageRanges([4, 2, 2, 3])).toBe('2–4')
  })

  it('renders a single page without a range', () => {
    expect(formatPageRanges([7])).toBe('7')
  })

  it('returns an empty string for no pages', () => {
    expect(formatPageRanges([])).toBe('')
  })
})

describe('toTimeAgo', () => {
  afterEach(() => vi.useRealTimers())

  const freezeAt = (iso: string) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(iso))
  }

  it('reports just-now under an hour', () => {
    freezeAt('2026-06-08T12:00:00Z')
    expect(toTimeAgo('2026-06-08T11:30:00Z')).toEqual({ kind: 'justNow' })
  })

  it('reports whole hours under a day', () => {
    freezeAt('2026-06-08T12:00:00Z')
    expect(toTimeAgo('2026-06-08T07:00:00Z')).toEqual({ kind: 'hours', count: 5 })
  })

  it('reports whole days beyond 24h', () => {
    freezeAt('2026-06-08T12:00:00Z')
    expect(toTimeAgo('2026-06-06T10:00:00Z')).toEqual({ kind: 'days', count: 2 })
  })
})
