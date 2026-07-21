/**
 * Connection-reset retry wrapper for the AI passes.
 *
 * Free OpenRouter models routinely drop the TLS socket mid-response: the request
 * returns `200`, then the body read is killed with `ECONNRESET` / `terminated`.
 * The AI SDK marks this class of failure `isRetryable: false`, so its own
 * `maxRetries` never fires and a whole chunk is lost (see the Step P incident).
 *
 * This helper retries ONLY transport-level resets the SDK refuses to retry —
 * HTTP-status failures (429/5xx) are left to the SDK's built-in backoff so we
 * don't double-retry them. Detection walks the error's `cause` chain because the
 * reset is buried two levels down (APICallError → TypeError "terminated" →
 * Error "read ECONNRESET").
 */

/**
 * Raised (or detected) when an AI call hits a provider rate limit — most commonly
 * OpenRouter's free-tier daily cap (`429 "Rate limit exceeded: free-models-per-day"`,
 * 50 requests/day account-wide). Unlike a per-block model failure (bad JSON, token
 * ceiling), a rate limit is **account-wide and sticky**: once hit, every subsequent
 * call in the same job hits it too. So the AI passes fail FAST on it (no split-retry —
 * every retry would 429 too, burning quota) and the orchestrator requeues the job to
 * `pending` rather than shipping a doc with the AI work silently skipped.
 */
export class RateLimitError extends Error {
  constructor(message = 'AI provider rate limit reached', options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RateLimitError'
  }
}

/**
 * True when the error (or any error in its cause chain) is a provider rate limit:
 * an HTTP 429, or OpenRouter's free-tier "…free-models-per-day" / "rate limit" body.
 * Walks the `cause` chain (the SDK buries the status a level or two down).
 */
export function isRateLimitError(err: unknown): boolean {
  let e: unknown = err
  const seen = new Set<unknown>()
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e)
    if (e instanceof RateLimitError) return true
    const status = (e as { statusCode?: unknown }).statusCode ?? (e as { status?: unknown }).status
    if (status === 429) return true
    const message = (e as { message?: unknown }).message
    if (typeof message === 'string') {
      const m = message.toLowerCase()
      if (m.includes('rate limit') || m.includes('rate-limit') || m.includes('free-models-per-day') || m.includes('too many requests')) return true
    }
    const body = (e as { responseBody?: unknown }).responseBody
    if (typeof body === 'string' && body.toLowerCase().includes('rate limit')) return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

const RESET_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'UND_ERR_SOCKET'])

/** True when the error (or any error in its cause chain) is a dropped connection. */
export function isConnectionResetError(err: unknown): boolean {
  let e: unknown = err
  const seen = new Set<unknown>()
  while (e && typeof e === 'object' && !seen.has(e)) {
    seen.add(e)
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && RESET_CODES.has(code)) return true
    const message = (e as { message?: unknown }).message
    if (typeof message === 'string') {
      const m = message.toLowerCase()
      if (
        m.includes('terminated') ||
        m.includes('econnreset') ||
        m.includes('socket hang up') ||
        m.includes('fetch failed') ||
        m.includes('failed to process successful response') ||
        m.includes('resourceexhausted') ||
        m.includes('request limit reached') ||
        m.includes('worker local')
      ) {
        return true
      }
    }
    e = (e as { cause?: unknown }).cause
  }
  return false
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export interface ConnectionRetryOptions {
  /** Extra attempts after the first try. Defaults to 2 (so up to 3 calls total). */
  retries?: number
  /** Base backoff in ms; each retry waits `baseDelayMs * 2^attempt` plus jitter. */
  baseDelayMs?: number
}

/**
 * Run `fn`, retrying with exponential backoff + jitter only when it fails with a
 * connection reset. Any other error (validation, auth, HTTP status) rethrows
 * immediately — those are either the SDK's job or genuinely fatal.
 */
export async function withConnectionRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, baseDelayMs = 500 }: ConnectionRetryOptions = {},
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // Never retry a rate limit — it is sticky (every retry 429s too). Checked first
      // because `isConnectionResetError` matches some overlapping phrasings.
      if (isRateLimitError(err)) throw err
      if (attempt === retries || !isConnectionResetError(err)) throw err
      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs)
      await sleep(delay)
    }
  }
  throw lastErr
}
