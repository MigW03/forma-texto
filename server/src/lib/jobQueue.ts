/**
 * In-process, concurrency-limited queue for `processFormatting` runs.
 *
 * `POST /api/processing/start` used to fire every accepted job immediately
 * (`void processFormatting(id)`) with no cap on how many ran at once. Staggering them
 * keeps peak CPU/memory bounded on a single budget host and keeps concurrent AI-call
 * bursts smaller. Deliberately minimal — an in-memory array, no external queue service.
 * Appropriate for a single Node process; would need to move to a real durable queue
 * (e.g. a Postgres-backed job table) if the server ever scales beyond one instance,
 * since this queue's state is lost on restart (acceptable today: a job that never got
 * to run is still `status='pending'` and gets picked up by the retry-pending cron; a
 * job that was mid-run is caught by `recoverStuckJobs`).
 */

export const MAX_CONCURRENT = 2

export interface JobQueueDeps {
  process(projectId: string): Promise<void>
}

export class JobQueue {
  private queue: string[] = []
  private active = 0

  constructor(
    private deps: JobQueueDeps,
    private maxConcurrent: number = MAX_CONCURRENT,
  ) {}

  /** Queue a job. Returns immediately; it starts once a concurrency slot frees up. */
  enqueue(projectId: string): void {
    this.queue.push(projectId)
    this.drain()
  }

  get pending(): number {
    return this.queue.length
  }

  get running(): number {
    return this.active
  }

  private drain(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const projectId = this.queue.shift()!
      this.active++
      this.deps
        .process(projectId)
        .catch((err) => {
          // processFormatting handles its own failures (requeues to pending); a throw
          // here is unexpected but must not sink the queue.
          console.error(`[jobQueue] ${projectId} threw past processFormatting's own error handling (unexpected):`, err)
        })
        .finally(() => {
          this.active--
          this.drain()
        })
    }
  }
}

let defaultQueue: JobQueue | null = null

function getDefaultQueue(): JobQueue {
  if (!defaultQueue) {
    // Lazy-require so importing this module never pulls in supabase/processFormatting
    // until a job is actually enqueued (keeps it side-effect-free for tests).
    const { processFormatting } = require('./processFormatting') as { processFormatting: (id: string) => Promise<void> }
    defaultQueue = new JobQueue({ process: processFormatting })
  }
  return defaultQueue
}

/** Queue a formatting run on the shared, concurrency-limited default queue. */
export function enqueueProcessing(projectId: string): void {
  getDefaultQueue().enqueue(projectId)
}
