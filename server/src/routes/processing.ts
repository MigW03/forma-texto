import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { processFormatting } from '../lib/processFormatting'

const router = Router()

/**
 * Authorize a processing trigger. Two accepted callers:
 *  1. Server-to-server / manual (curl, n8n): shared `x-webhook-secret`.
 *  2. The frontend: a Supabase access token (Bearer) belonging to the
 *     project's owner. Prevents triggering processing on someone else's project.
 */
async function authorize(req: Request, projectId: string): Promise<boolean> {
  const secret = process.env.WEBHOOK_SECRET
  if (secret && req.headers['x-webhook-secret'] === secret) return true

  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return false

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) return false

  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .single()
  return !!project && project.user_id === userData.user.id
}

// POST /api/processing/start  { projectId }
// Kicks off the formatting pipeline in the background and returns immediately.
router.post('/start', async (req: Request, res: Response) => {
  const { projectId } = req.body as { projectId?: string }
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  if (!(await authorize(req, projectId))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // Fire-and-forget: in-process async job. Respond 202 right away.
  void processFormatting(projectId)
  res.status(202).json({ accepted: true, projectId })
})

export default router
