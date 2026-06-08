import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { localizedDescription, useGuidelines, FALLBACK_GUIDELINES } from './guidelines'

describe('localizedDescription', () => {
  const desc = { en: 'English', 'pt-BR': 'Brasil' }

  it('prefers an exact language match', () => {
    expect(localizedDescription(desc, 'pt-BR')).toBe('Brasil')
  })

  it('falls back to the base language', () => {
    expect(localizedDescription({ pt: 'Base', en: 'English' }, 'pt-PT')).toBe('Base')
  })

  it('falls back to English, then to the first value', () => {
    expect(localizedDescription({ en: 'English' }, 'fr')).toBe('English')
    expect(localizedDescription({ de: 'Deutsch' }, 'fr')).toBe('Deutsch')
  })

  it('returns an empty string for an empty map', () => {
    expect(localizedDescription({}, 'en')).toBe('')
  })
})

describe('useGuidelines', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('starts with the built-in fallback', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves
    const { result } = renderHook(() => useGuidelines())
    expect(result.current).toEqual(FALLBACK_GUIDELINES)
  })

  it('replaces the fallback with the API catalog on success', async () => {
    const catalog = [
      { id: 'abnt', name: 'ABNT', description: { en: 'x' } },
      { id: 'apa', name: 'APA', description: { en: 'y' } },
    ]
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ guidelines: catalog }) })))
    const { result } = renderHook(() => useGuidelines())
    await waitFor(() => expect(result.current).toEqual(catalog))
  })

  it('keeps the fallback when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { result } = renderHook(() => useGuidelines())
    // Give the rejected fetch a tick; the hook must not change.
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current).toEqual(FALLBACK_GUIDELINES)
  })

  it('keeps the fallback on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    const { result } = renderHook(() => useGuidelines())
    await new Promise((r) => setTimeout(r, 0))
    expect(result.current).toEqual(FALLBACK_GUIDELINES)
  })
})
