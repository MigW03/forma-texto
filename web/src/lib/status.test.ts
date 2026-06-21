import { describe, it, expect } from 'vitest'
import { normalizeStatus, STATUS_BADGE_VARIANT } from './status'

describe('normalizeStatus', () => {
  it('passes through the known statuses', () => {
    expect(normalizeStatus('pending')).toBe('pending')
    expect(normalizeStatus('processing')).toBe('processing')
    expect(normalizeStatus('needs_input')).toBe('needs_input')
    expect(normalizeStatus('missing_file')).toBe('missing_file')
    expect(normalizeStatus('complete')).toBe('complete')
  })

  it('defaults unknown / legacy / empty values to pending', () => {
    expect(normalizeStatus('ready')).toBe('pending') // retired legacy value
    expect(normalizeStatus('delivered')).toBe('pending') // retired legacy value
    expect(normalizeStatus('')).toBe('pending')
    expect(normalizeStatus(null)).toBe('pending')
    expect(normalizeStatus(undefined)).toBe('pending')
  })
})

describe('STATUS_BADGE_VARIANT', () => {
  it('maps every status to a badge variant', () => {
    expect(STATUS_BADGE_VARIANT).toEqual({
      pending: 'default',
      processing: 'processing',
      needs_input: 'needs_input',
      missing_file: 'missing_file',
      complete: 'complete',
    })
  })
})
