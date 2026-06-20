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
        m.includes('failed to process successful response')
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
      if (attempt === retries || !isConnectionResetError(err)) throw err
      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * baseDelayMs)
      await sleep(delay)
    }
  }
  throw lastErr
}
