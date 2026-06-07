import { Router, Request, Response } from 'express'
import { listGuidelines } from '../lib/formatting'

const router = Router()

/**
 * GET /api/guidelines — the formatting guidelines offered in the project-creation
 * dropdown. Enumerated from the spec files in `lib/formatting/specs/`, so adding a
 * new `{id}.md` adds a dropdown option with no code change. Public (no auth):
 * it's static catalog data the unauthenticated GetStarted page needs.
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    res.json({ guidelines: listGuidelines() })
  } catch (err) {
    console.error('list guidelines failed:', err)
    res.status(500).json({ error: 'Failed to list guidelines' })
  }
})

export default router
