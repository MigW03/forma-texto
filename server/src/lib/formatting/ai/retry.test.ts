import { describe, it, expect } from 'vitest'
import { isConnectionResetError, isRateLimitError, RateLimitError, withConnectionRetry } from './retry'

/** Build the nested error the AI SDK throws on a mid-stream reset. */
function makeResetError(): Error {
  const root = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
  const mid = Object.assign(new TypeError('terminated'), { cause: root })
  return Object.assign(new Error('Failed to process successful response'), { cause: mid })
}

describe('isConnectionResetError', () => {
  it('detects a reset buried in the cause chain', () => {
    expect(isConnectionResetError(makeResetError())).toBe(true)
  })

  it('detects by code at the top level', () => {
    expect(isConnectionResetError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true)
  })

  it('detects by message phrasing', () => {
    expect(isConnectionResetError(new Error('socket hang up'))).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isConnectionResetError(new Error('schema validation failed'))).toBe(false)
    expect(isConnectionResetError(Object.assign(new Error('rate limited'), { code: 'ERR_429' }))).toBe(false)
  })

  it('survives a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b') as Error & { cause?: unknown }
    a.cause = b
    b.cause = a
    expect(isConnectionResetError(a)).toBe(false)
  })
})

describe('isRateLimitError', () => {
  it('detects an HTTP 429 by statusCode', () => {
    expect(isRateLimitError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 }))).toBe(true)
  })

  it("detects OpenRouter's free-tier daily-cap message", () => {
    expect(isRateLimitError(new Error('Rate limit exceeded: free-models-per-day. Add credits to unlock.'))).toBe(true)
  })

  it('detects a 429 buried in the cause chain', () => {
    const root = Object.assign(new Error('429'), { statusCode: 429 })
    const wrapped = Object.assign(new Error('AI call failed'), { cause: root })
    expect(isRateLimitError(wrapped)).toBe(true)
  })

  it('detects a RateLimitError instance', () => {
    expect(isRateLimitError(new RateLimitError())).toBe(true)
  })

  it('detects it inside the provider responseBody', () => {
    expect(isRateLimitError(Object.assign(new Error('call failed'), { responseBody: '{"error":{"message":"Rate limit exceeded"}}' }))).toBe(true)
  })

  it('ignores unrelated errors (a token-ceiling / schema failure is NOT a rate limit)', () => {
    expect(isRateLimitError(new Error('No object generated: finishReason length'))).toBe(false)
    expect(isRateLimitError(new Error('schema validation failed'))).toBe(false)
    expect(isRateLimitError(Object.assign(new Error('server error'), { statusCode: 500 }))).toBe(false)
  })

  it('survives a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b') as Error & { cause?: unknown }
    a.cause = b
    b.cause = a
    expect(isRateLimitError(a)).toBe(false)
  })
})

describe('withConnectionRetry', () => {
  it('never retries a rate limit — it is sticky (fails fast on the first hit)', async () => {
    let calls = 0
    await expect(
      withConnectionRetry(
        async () => {
          calls++
          throw new RateLimitError()
        },
        { retries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(RateLimitError)
    expect(calls).toBe(1)
  })

  it('retries a reset then succeeds', async () => {
    let calls = 0
    const result = await withConnectionRetry(
      async () => {
        calls++
        if (calls < 3) throw makeResetError()
        return 'ok'
      },
      { retries: 3, baseDelayMs: 1 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('gives up after exhausting retries and rethrows', async () => {
    let calls = 0
    await expect(
      withConnectionRetry(
        async () => {
          calls++
          throw makeResetError()
        },
        { retries: 2, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('Failed to process successful response')
    expect(calls).toBe(3) // 1 initial + 2 retries
  })

  it('does not retry a non-reset error', async () => {
    let calls = 0
    await expect(
      withConnectionRetry(
        async () => {
          calls++
          throw new Error('schema validation failed')
        },
        { retries: 3, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('schema validation failed')
    expect(calls).toBe(1)
  })
})
