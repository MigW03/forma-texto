import { describe, it, expect } from 'vitest'
import { repairDecisions } from './headingDecider'

/**
 * Weak models drop the `{ decisions: [...] }` wrapper that the schema expects.
 * `repairDecisions` reshapes the common malformed outputs back into the wrapper
 * so a flaky model never fails a paid job. These cover the shapes seen in the wild.
 */
describe('repairDecisions', () => {
  const arr = [
    { i: 0, role: 'title' },
    { i: 3, role: 'h1' },
  ]
  const wrapped = JSON.stringify({ decisions: arr })

  it('wraps a bare array (the observed failure)', async () => {
    const out = await repairDecisions({ text: JSON.stringify(arr) })
    expect(out).toBe(wrapped)
  })

  it('leaves an already-correct object untouched', async () => {
    const out = await repairDecisions({ text: JSON.stringify({ decisions: arr }) })
    expect(JSON.parse(out!)).toEqual({ decisions: arr })
  })

  it('rewraps an array placed under a different key', async () => {
    const out = await repairDecisions({ text: JSON.stringify({ results: arr }) })
    expect(JSON.parse(out!)).toEqual({ decisions: arr })
  })

  it('salvages a JSON array fenced in markdown / prose', async () => {
    const text = 'Here are the decisions:\n```json\n' + JSON.stringify(arr) + '\n```'
    const out = await repairDecisions({ text })
    expect(JSON.parse(out!)).toEqual({ decisions: arr })
  })

  it('returns null when there is nothing salvageable', async () => {
    expect(await repairDecisions({ text: 'no json here' })).toBeNull()
  })
})
