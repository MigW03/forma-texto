/**
 * Retry pending jobs.
 *
 * A processing run that hits the AI provider's rate limit (e.g. OpenRouter's
 * free-tier 50/day cap) aborts BEFORE stamping `complete` and leaves the project
 * `pending` (see `processFormatting`'s outer catch) — deliberately, so a doc with the
 * AI passes silently skipped never ships. This job re-triggers those `pending` jobs so
 * they finish once quota is available again.
 *
 * Cadence matters: the free-tier cap resets daily, so the scheduler runs this ONCE a
 * day, shortly after the reset (see `sql/retry_pending_cron.sql`) — a rate-limited job
 * then gets one retry per reset window rather than burning its whole attempt budget in
 * an hour while quota is still exhausted. `processing_attempts` caps how many automated
 * retries a job gets before it's left for manual intervention (a genuinely broken doc
 * shouldn't loop forever). Manual retries via `POST /api/processing/start` bypass this
 * cap entirely — they're user-initiated.
 *
 * Only PAID jobs that still have their uploaded file and have waited out a short grace
 * window (so a brand-new project mid-processing isn't grabbed) are eligible.
 */

/** Automated retries a job gets before it's left alone (manual /start still works). */
export const MAX_RETRY_ATTEMPTS = 3
/** Skip jobs created within this window — they're likely still processing, not stuck. */
export const RETRY_GRACE_MINUTES = 10

export interface RetriableJob {
  id: string
  processing_attempts: number | null
}

export interface RetryResult {
  scanned: number
  retried: number
  errors: string[]
}

/**
 * Injectable seam so the logic is unit-testable without Supabase or the real pipeline.
 * The default implementation (built in `retryPendingJobs`) wires the real client +
 * `processFormatting`.
 */
export interface RetryPendingDeps {
  /** Pending, paid, file-present jobs under the attempt cap and past the grace window. */
  listRetriable(graceCutoffIso: string, maxAttempts: number): Promise<{ data: RetriableJob[] | null; error: { message: string } | null }>
  /** Record another attempt before reprocessing. */
  bumpAttempts(id: string, attempts: number): Promise<{ error: { message: string } | null }>
  /** Re-run the pipeline for one job (awaited so the batch stays sequential). */
  process(id: string): Promise<void>
}

function defaultDeps(): RetryPendingDeps {
  // Lazy-require so unit tests injecting a fake never import supabase.ts (which throws
  // without env vars) or processFormatting.
  const { supabase } = require('./supabase') as { supabase: any }
  const { processFormatting } = require('./processFormatting') as { processFormatting: (id: string) => Promise<void> }
  return {
    async listRetriable(graceCutoffIso, maxAttempts) {
      return supabase
        .from('projects')
        .select('id, processing_attempts')
        .eq('status', 'pending')
        .not('order_id', 'is', null)
        .not('original_file_path', 'is', null)
        .lt('created_at', graceCutoffIso)
        .lt('processing_attempts', maxAttempts)
    },
    async bumpAttempts(id, attempts) {
      return supabase.from('projects').update({ processing_attempts: attempts }).eq('id', id)
    },
    process: processFormatting,
  }
}

/**
 * Re-trigger eligible `pending` jobs, sequentially (one at a time — they share the same
 * rate-limited quota, so parallel retries would just all 429). Each job's
 * `processing_attempts` is incremented before it runs, so a job that keeps rate-limiting
 * is retried on later cron runs until it hits `MAX_RETRY_ATTEMPTS`. Non-fatal per job.
 */
export async function retryPendingJobs(
  deps: RetryPendingDeps = defaultDeps(),
  now: Date = new Date(),
): Promise<RetryResult> {
  const result: RetryResult = { scanned: 0, retried: 0, errors: [] }
  const graceCutoffIso = new Date(now.getTime() - RETRY_GRACE_MINUTES * 60_000).toISOString()

  const { data: rows, error } = await deps.listRetriable(graceCutoffIso, MAX_RETRY_ATTEMPTS)
  if (error) {
    result.errors.push(`query: ${error.message}`)
    return result
  }
  if (!rows || rows.length === 0) return result
  result.scanned = rows.length

  for (const row of rows) {
    const { error: bumpErr } = await deps.bumpAttempts(row.id, (row.processing_attempts ?? 0) + 1)
    if (bumpErr) {
      result.errors.push(`bump ${row.id}: ${bumpErr.message}`)
      continue
    }
    try {
      await deps.process(row.id)
      result.retried += 1
    } catch (err) {
      // processFormatting handles its own failures (requeues to pending); a throw here
      // is unexpected but must not sink the rest of the batch.
      result.errors.push(`process ${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}

/**
 * Recover jobs orphaned by a server crash/restart.
 *
 * `processFormatting` runs entirely in-process with no per-step checkpoint — if the
 * server dies mid-job, the project is left `status='processing'` forever with nothing
 * watching that state (the retry-pending job above only scans `pending`). This sweep
 * catches that: any project still `processing` past `STUCK_THRESHOLD_MINUTES` since its
 * `processing_started_at` heartbeat is reset to `pending`, so it flows back through the
 * normal retry path (manual `/api/processing/start`, or the pending-retry cron).
 *
 * 2 hours is well past how long even a large (~40-lauda) document's sequential AI
 * passes take in normal operation (observed ~30min on a real document, so this leaves
 * a wide margin), so a false-positive reset of a genuinely in-flight job should not
 * happen in practice.
 */
export const STUCK_THRESHOLD_MINUTES = 120

export interface StuckJob {
  id: string
}

export interface RecoverStuckResult {
  scanned: number
  recovered: number
  errors: string[]
}

export interface RecoverStuckDeps {
  /** Projects still 'processing' with a heartbeat older than the stale cutoff. */
  listStuck(staleCutoffIso: string): Promise<{ data: StuckJob[] | null; error: { message: string } | null }>
  /** Reset one orphaned job back to 'pending'. */
  resetToPending(id: string): Promise<{ error: { message: string } | null }>
}

function defaultRecoverDeps(): RecoverStuckDeps {
  const { supabase } = require('./supabase') as { supabase: any }
  return {
    async listStuck(staleCutoffIso) {
      return supabase
        .from('projects')
        .select('id')
        .eq('status', 'processing')
        .lt('processing_started_at', staleCutoffIso)
    },
    async resetToPending(id) {
      return supabase.from('projects').update({ status: 'pending' }).eq('id', id)
    },
  }
}

export async function recoverStuckJobs(
  deps: RecoverStuckDeps = defaultRecoverDeps(),
  now: Date = new Date(),
): Promise<RecoverStuckResult> {
  const result: RecoverStuckResult = { scanned: 0, recovered: 0, errors: [] }
  const staleCutoffIso = new Date(now.getTime() - STUCK_THRESHOLD_MINUTES * 60_000).toISOString()

  const { data: rows, error } = await deps.listStuck(staleCutoffIso)
  if (error) {
    result.errors.push(`query: ${error.message}`)
    return result
  }
  if (!rows || rows.length === 0) return result
  result.scanned = rows.length

  for (const row of rows) {
    console.log(`[recoverStuckJobs] caught stuck job ${row.id} — status='processing' past ${STUCK_THRESHOLD_MINUTES}min, resetting to 'pending'`)
    const { error: resetErr } = await deps.resetToPending(row.id)
    if (resetErr) {
      result.errors.push(`reset ${row.id}: ${resetErr.message}`)
      continue
    }
    console.warn(`[recoverStuckJobs] ${row.id} reset to 'pending' (likely an orphaned job from a server crash/restart)`)
    result.recovered += 1
  }

  return result
}
