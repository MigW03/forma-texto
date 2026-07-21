import { describe, it, expect } from 'vitest'
import {
  retryPendingJobs,
  RETRY_GRACE_MINUTES,
  MAX_RETRY_ATTEMPTS,
  type RetryPendingDeps,
  type RetriableJob,
} from './retryPendingJobs'

/** Build injectable deps around a list of rows, recording bumps and processed ids. */
function makeDeps(
  rows: RetriableJob[],
  opts: { listError?: string; bumpError?: string; throwOn?: string } = {},
): RetryPendingDeps & { bumped: [string, number][]; processed: string[]; listArgs: [string, number][] } {
  const bumped: [string, number][] = []
  const processed: string[] = []
  const listArgs: [string, number][] = []
  return {
    bumped,
    processed,
    listArgs,
    async listRetriable(graceCutoffIso, maxAttempts) {
      listArgs.push([graceCutoffIso, maxAttempts])
      if (opts.listError) return { data: null, error: { message: opts.listError } }
      return { data: rows, error: null }
    },
    async bumpAttempts(id, attempts) {
      if (opts.bumpError) return { error: { message: opts.bumpError } }
      bumped.push([id, attempts])
      return { error: null }
    },
    async process(id) {
      if (opts.throwOn === id) throw new Error('boom')
      processed.push(id)
    },
  }
}

describe('retryPendingJobs', () => {
  it('bumps attempts and reprocesses each eligible job, sequentially', async () => {
    const deps = makeDeps([
      { id: 'a', processing_attempts: 0 },
      { id: 'b', processing_attempts: 2 },
    ])
    const result = await retryPendingJobs(deps)
    expect(result).toEqual({ scanned: 2, retried: 2, errors: [] })
    expect(deps.bumped).toEqual([['a', 1], ['b', 3]]) // attempts incremented before processing
    expect(deps.processed).toEqual(['a', 'b'])
  })

  it('treats a null attempts count as 0', async () => {
    const deps = makeDeps([{ id: 'a', processing_attempts: null }])
    await retryPendingJobs(deps)
    expect(deps.bumped).toEqual([['a', 1]])
  })

  it('passes the grace cutoff and the max-attempts cap to the query', async () => {
    const now = new Date('2026-07-20T12:00:00.000Z')
    const deps = makeDeps([])
    await retryPendingJobs(deps, now)
    const [cutoffIso, maxAttempts] = deps.listArgs[0]
    expect(new Date(cutoffIso).getTime()).toBe(now.getTime() - RETRY_GRACE_MINUTES * 60_000)
    expect(maxAttempts).toBe(MAX_RETRY_ATTEMPTS)
  })

  it('returns early on a query error without processing anything', async () => {
    const deps = makeDeps([{ id: 'a', processing_attempts: 0 }], { listError: 'db down' })
    const result = await retryPendingJobs(deps)
    expect(result.errors).toEqual(['query: db down'])
    expect(result.retried).toBe(0)
    expect(deps.processed).toEqual([])
  })

  it('no rows → clean no-op', async () => {
    const deps = makeDeps([])
    expect(await retryPendingJobs(deps)).toEqual({ scanned: 0, retried: 0, errors: [] })
  })

  it('skips a job whose attempt bump fails (no double-process), continues the rest', async () => {
    const deps = makeDeps([{ id: 'a', processing_attempts: 0 }, { id: 'b', processing_attempts: 0 }], { bumpError: 'stamp failed' })
    const result = await retryPendingJobs(deps)
    // Both bumps fail → both recorded as errors, neither processed.
    expect(result.retried).toBe(0)
    expect(result.errors).toHaveLength(2)
    expect(deps.processed).toEqual([])
  })

  it('records a processing throw per job without sinking the batch', async () => {
    const deps = makeDeps([{ id: 'a', processing_attempts: 0 }, { id: 'b', processing_attempts: 0 }], { throwOn: 'a' })
    const result = await retryPendingJobs(deps)
    expect(result.retried).toBe(1) // b still ran
    expect(deps.processed).toEqual(['b'])
    expect(result.errors).toEqual(['process a: boom'])
  })
})
