import { describe, it, expect, vi } from 'vitest'
import {
  retryPendingJobs,
  RETRY_GRACE_MINUTES,
  MAX_RETRY_ATTEMPTS,
  recoverStuckJobs,
  STUCK_THRESHOLD_MINUTES,
  type RetryPendingDeps,
  type RetriableJob,
  type RecoverStuckDeps,
  type StuckJob,
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

/** Build injectable deps around a list of stuck rows, recording resets. */
function makeRecoverDeps(
  rows: StuckJob[],
  opts: { listError?: string; resetError?: string } = {},
): RecoverStuckDeps & { reset: string[]; listArgs: string[] } {
  const reset: string[] = []
  const listArgs: string[] = []
  return {
    reset,
    listArgs,
    async listStuck(staleCutoffIso) {
      listArgs.push(staleCutoffIso)
      if (opts.listError) return { data: null, error: { message: opts.listError } }
      return { data: rows, error: null }
    },
    async resetToPending(id) {
      if (opts.resetError) return { error: { message: opts.resetError } }
      reset.push(id)
      return { error: null }
    },
  }
}

describe('recoverStuckJobs', () => {
  it('resets every stuck job to pending', async () => {
    const deps = makeRecoverDeps([{ id: 'a' }, { id: 'b' }])
    const result = await recoverStuckJobs(deps)
    expect(result).toEqual({ scanned: 2, recovered: 2, errors: [] })
    expect(deps.reset).toEqual(['a', 'b'])
  })

  it('logs the project id as soon as a stuck job is caught, even if the reset later fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = makeRecoverDeps([{ id: 'a' }], { resetError: 'db down' })
    await recoverStuckJobs(deps)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('a'))
    expect(warnSpy).not.toHaveBeenCalled() // only logs success on an actual reset
    logSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('passes the stale cutoff to the query', async () => {
    const now = new Date('2026-07-20T12:00:00.000Z')
    const deps = makeRecoverDeps([])
    await recoverStuckJobs(deps, now)
    expect(new Date(deps.listArgs[0]).getTime()).toBe(now.getTime() - STUCK_THRESHOLD_MINUTES * 60_000)
  })

  it('returns early on a query error without resetting anything', async () => {
    const deps = makeRecoverDeps([{ id: 'a' }], { listError: 'db down' })
    const result = await recoverStuckJobs(deps)
    expect(result.errors).toEqual(['query: db down'])
    expect(result.recovered).toBe(0)
    expect(deps.reset).toEqual([])
  })

  it('no rows → clean no-op', async () => {
    const deps = makeRecoverDeps([])
    expect(await recoverStuckJobs(deps)).toEqual({ scanned: 0, recovered: 0, errors: [] })
  })

  it('records a reset failure per job without sinking the batch', async () => {
    const deps = makeRecoverDeps([{ id: 'a' }], { resetError: 'update failed' })
    const result = await recoverStuckJobs(deps)
    expect(result.recovered).toBe(0)
    expect(result.errors).toEqual(['reset a: update failed'])
  })
})
