import { Router, Request, Response } from 'express'
import { cleanupExpiredFiles } from '../lib/cleanupExpiredFiles'
import { retryPendingJobs } from '../lib/retryPendingJobs'

const router = Router()

/** Shared secret for server-to-server / scheduler calls (same as other webhooks). */
function authorized(req: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return false
  return req.headers['x-webhook-secret'] === secret
}

// POST /api/maintenance/cleanup-expired
// Deletes the stored files of any project past its `delete_files_at` deadline
// and stamps `files_deleted_at`. Safe to call repeatedly (idempotent — already
// cleaned projects are skipped). Trigger from any scheduler (pg_cron http, n8n,
// external cron) or rely on the in-process daily timer in index.ts.
router.post('/cleanup-expired', async (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const result = await cleanupExpiredFiles()
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[maintenance] cleanup-expired failed', err)
    res.status(500).json({ error: 'cleanup failed' })
  }
})

// POST /api/maintenance/retry-pending
// Re-triggers `pending` jobs that stalled (most commonly an AI-provider rate limit
// requeued them). Meant for a DAILY scheduler aligned after the free-tier reset
// (sql/retry_pending_cron.sql). Caps automated retries per job; manual retries via
// /api/processing/start bypass the cap.
router.post('/retry-pending', async (req: Request, res: Response) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const result = await retryPendingJobs()
    console.log(`[maintenance] retry-pending: scanned ${result.scanned}, retried ${result.retried}, errors ${result.errors.length}`)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[maintenance] retry-pending failed', err)
    res.status(500).json({ error: 'retry failed' })
  }
})

export default router
