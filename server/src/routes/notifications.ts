import { Router, Request, Response } from 'express'
import { sendProjectReadyEmail } from '../lib/notify'

const router = Router()

/** Shared secret n8n sends in x-webhook-secret header */
function isAuthorized(req: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return false
  return req.headers['x-webhook-secret'] === secret
}

router.post('/project-ready', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { projectId } = req.body as { projectId?: string }
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  try {
    await sendProjectReadyEmail(projectId)
    res.json({ ok: true })
  } catch (err) {
    console.error('project-ready failed:', err)
    res.status(500).json({ error: 'Failed to send email' })
  }
})

export default router
