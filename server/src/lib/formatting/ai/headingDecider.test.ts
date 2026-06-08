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

  it('salvages complete decisions from a response truncated mid-JSON (finishReason length)', async () => {
    // Two complete decisions, then a third cut off mid-string (the observed failure).
    const truncated =
      '{"decisions": [' +
      '{"i": 12, "segments": [{"text": "Dos, C. "}, {"text": "Título", "emphasis": "bold"}, {"text": "."}]}, ' +
      '{"i": 15, "segments": [{"text": "ABNT. "}, {"text": "ABNT NBR 16175", "emphasis": "bold"}]}, ' +
      '{"i": 16, "segments": [{"text": "**AIRBAG: TUDO SOBRE ES'
    const out = await repairDecisions({ text: truncated })
    const parsed = JSON.parse(out!)
    expect(parsed.decisions.map((d: { i: number }) => d.i)).toEqual([12, 15]) // 16 dropped (incomplete)
    expect(parsed.decisions[0].segments[1]).toEqual({ text: 'Título', emphasis: 'bold' })
  })
})
