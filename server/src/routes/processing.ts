import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { processFormatting } from '../lib/processFormatting'
import {
  fillContent,
  removeContent,
  unzipDocx,
  zipDocx,
  type PendingInput,
  type RemovedInput,
} from '../lib/formatting'

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

const BUCKET = 'projects'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// POST /api/processing/fill-content  { projectId, fills?, removals? }
// Applies user-supplied caption text (fills) and/or intentional removals to the
// processed DOCX, then updates project status (needs_input → complete when all
// pending inputs are resolved).
router.post('/fill-content', async (req: Request, res: Response) => {
  const { projectId, fills, removals } = req.body as {
    projectId?: string
    fills?: Record<string, string>
    removals?: string[]
  }

  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  const hasFills    = fills    && Object.keys(fills).length    > 0
  const hasRemovals = removals && removals.length > 0
  if (!hasFills && !hasRemovals) {
    res.status(400).json({ error: 'at least one fill or removal required' })
    return
  }

  if (!(await authorize(req, projectId))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('status, pending_inputs, removed_inputs, processed_file_path, user_id')
    .eq('id', projectId)
    .single()

  if (projErr || !project) {
    res.status(404).json({ error: 'project not found' })
    return
  }
  if (project.status !== 'needs_input' || !project.pending_inputs) {
    res.status(409).json({ error: 'project is not awaiting input' })
    return
  }

  const pendingInputs = project.pending_inputs as PendingInput[]
  const pendingIds = new Set(pendingInputs.map(p => p.id))

  const unknownFillKeys    = Object.keys(fills    ?? {}).filter(k => !pendingIds.has(k))
  const unknownRemovalKeys = (removals ?? []).filter(k => !pendingIds.has(k))
  if (unknownFillKeys.length || unknownRemovalKeys.length) {
    res.status(400).json({ error: 'unknown input ids', unknownFillKeys, unknownRemovalKeys })
    return
  }

  // Download the current processed DOCX
  const { data: fileData, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(project.processed_file_path)
  if (dlErr || !fileData) {
    res.status(500).json({ error: 'failed to download processed file' })
    return
  }

  const arrayBuf  = await fileData.arrayBuffer()
  const unzipped  = unzipDocx(Buffer.from(arrayBuf))
  const { files, documentXml, stylesXml } = unzipped

  let workingDocXml = documentXml
  if (hasFills)    workingDocXml = fillContent(workingDocXml, pendingInputs, fills!)
  if (hasRemovals) workingDocXml = removeContent(workingDocXml, pendingInputs, removals!)

  const docxBuf = zipDocx(files, { documentXml: workingDocXml, stylesXml })

  // Upload back (upsert)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(project.processed_file_path, docxBuf, { contentType: DOCX_MIME, upsert: true })
  if (upErr) {
    res.status(500).json({ error: 'failed to upload updated file' })
    return
  }

  const resolvedIds = new Set([
    ...Object.keys(fills ?? {}),
    ...(removals ?? []),
  ])
  const remaining = pendingInputs.filter(p => !resolvedIds.has(p.id))

  const now = new Date().toISOString()
  const newRemovedInputs: RemovedInput[] = [
    ...((project.removed_inputs as RemovedInput[] | null) ?? []),
    ...(removals ?? []).map(id => {
      const inp = pendingInputs.find(p => p.id === id)!
      return { id, kind: inp.kind, removedAt: now }
    }),
  ]

  if (remaining.length === 0) {
    const { error: updErr } = await supabase
      .from('projects')
      .update({
        status: 'complete',
        completed_at: now,
        pending_inputs: null,
        removed_inputs: newRemovedInputs.length > 0 ? newRemovedInputs : null,
      })
      .eq('id', projectId)
    if (updErr) {
      res.status(500).json({ error: 'failed to update project status' })
      return
    }
    // Non-fatal ready email
    try {
      const { sendProjectReadyEmail } = await import('../lib/notify')
      await sendProjectReadyEmail(projectId)
    } catch (err) {
      console.error(`[fill-content] email failed for ${projectId} (non-fatal):`, err)
    }
  } else {
    const { error: updErr } = await supabase
      .from('projects')
      .update({
        pending_inputs: remaining,
        removed_inputs: newRemovedInputs.length > 0 ? newRemovedInputs : null,
      })
      .eq('id', projectId)
    if (updErr) {
      res.status(500).json({ error: 'failed to update project' })
      return
    }
  }

  res.json({ ok: true, remaining: remaining.length })
})

export default router
