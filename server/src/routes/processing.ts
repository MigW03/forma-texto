import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { exportPdfBeside } from '../lib/processFormatting'
import { unzipDocx, zipDocx, finalizeInputs, detectPretextual, type PendingInput } from '../lib/formatting'
import { paginateSumario } from '../lib/paginateSumario'
import { sendProjectReadyEmail } from '../lib/notify'
import { processingLimiter } from '../lib/rateLimit'
import { enqueueProcessing } from '../lib/jobQueue'

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
router.post('/start', processingLimiter, async (req: Request, res: Response) => {
  const { projectId } = req.body as { projectId?: string }
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  if (!(await authorize(req, projectId))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // Queue the job (concurrency-limited, see jobQueue.ts) and respond right away.
  enqueueProcessing(projectId)
  res.status(202).json({ accepted: true, projectId })
})

const BUCKET = 'projects'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// POST /api/processing/finalize-inputs  { projectId, fills, removals }
// Applies all pending caption fills and removals atomically, stamps complete, sends email.
router.post('/finalize-inputs', async (req: Request, res: Response) => {
  const { projectId, fills = [], removals = [] } = req.body as {
    projectId?: string
    fills?: { id: string; text: string }[]
    removals?: string[]
  }

  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  if (!(await authorize(req, projectId))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: project, error: fetchErr } = await supabase
    .from('projects')
    .select('id, user_id, processed_file_path, status, pending_inputs, original_file_name')
    .eq('id', projectId)
    .single()

  if (fetchErr || !project) {
    res.status(404).json({ error: 'project not found' })
    return
  }

  if (project.status === 'complete') {
    // Already finalized — idempotent success (retry-safe after a network hiccup)
    res.json({ ok: true })
    return
  }
  if (project.status !== 'needs_input') {
    res.status(409).json({ error: `project status is '${project.status}', expected 'needs_input'` })
    return
  }

  const pending = (project.pending_inputs ?? []) as PendingInput[]
  const pendingIds = new Set(pending.map(p => p.id))

  // All IDs in fills and removals must be known
  const allIds = [...fills.map(f => f.id), ...removals]
  const unknown = allIds.filter(id => !pendingIds.has(id))
  if (unknown.length > 0) {
    res.status(400).json({ error: `unknown pending input id(s): ${unknown.join(', ')}` })
    return
  }

  // Every pending slot must be resolved (filled or removed)
  const resolvedIds = new Set(allIds)
  const unresolved = pending.filter(p => !resolvedIds.has(p.id))
  if (unresolved.length > 0) {
    res.status(400).json({ error: `${unresolved.length} pending input(s) not resolved` })
    return
  }

  if (!project.processed_file_path) {
    res.status(422).json({ error: 'no processed file found' })
    return
  }

  const { data: blob, error: dlErr } = await supabase.storage
    .from(BUCKET)
    .download(project.processed_file_path)
  if (dlErr || !blob) {
    res.status(500).json({ error: `download failed: ${dlErr?.message ?? 'no data'}` })
    return
  }

  const inputBuf = new Uint8Array(await blob.arrayBuffer())
  const { files, documentXml, stylesXml } = unzipDocx(inputBuf)
  let finalXml = finalizeInputs(documentXml, fills, removals, pending)
  // The document is only now final (user fills applied), so the sumário pagination —
  // the pipeline's LAST content transform — runs here for needs_input docs (the
  // processing pass skipped it to avoid baking placeholder-shifted page numbers).
  // Non-fatal: on failure the page numbers stay blank.
  const finalPretextual = detectPretextual(finalXml)
  finalXml = await paginateSumario(files, finalXml, stylesXml, projectId, {
    sections: finalPretextual.sections,
    bodyStart: finalPretextual.bodyStart,
  })
  const docxBuf = zipDocx(files, { documentXml: finalXml, stylesXml })

  // Real cacheControl TTL (not '0') — the client keys the URL on `completed_at`,
  // which this endpoint bumps below, so an overwrite is served fresh without
  // disabling CDN caching for every view.
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(project.processed_file_path, docxBuf, { contentType: DOCX_MIME, upsert: true, cacheControl: '3600' })
  if (upErr) {
    res.status(500).json({ error: `upload failed: ${upErr.message}` })
    return
  }

  // The doc is now final (placeholders resolved) — export the PDF beside it. Deferred to
  // here (not done in processFormatting for needs_input docs) so the PDF reflects the
  // user's filled captions/sources, never the red placeholders. Non-fatal.
  await exportPdfBeside(docxBuf, project.processed_file_path, projectId)

  const { error: updErr } = await supabase
    .from('projects')
    .update({ status: 'complete', pending_inputs: null, completed_at: new Date().toISOString() })
    .eq('id', projectId)
  if (updErr) {
    res.status(500).json({ error: `status update failed: ${updErr.message}` })
    return
  }

  try {
    await sendProjectReadyEmail(projectId)
  } catch (err) {
    console.error(`[finalize-inputs] email failed for ${projectId} (non-fatal):`, err)
  }

  res.json({ ok: true })
})

// POST /api/processing/recover-file  { projectId, path, fileName? }
// Missing-file recovery: a project flagged `missing_file` (paid, but its upload never
// arrived) gets a re-uploaded file. The client uploads the bytes to Storage itself (same
// path scheme as checkout, under its own RLS), then calls this to stamp the path and
// re-trigger the pipeline. No new order is created — the user is not re-charged.
router.post('/recover-file', async (req: Request, res: Response) => {
  const { projectId, path, fileName } = req.body as {
    projectId?: string
    path?: string
    fileName?: string
  }

  if (!projectId || !path) {
    res.status(400).json({ error: 'projectId and path required' })
    return
  }

  if (!(await authorize(req, projectId))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { data: project, error: fetchErr } = await supabase
    .from('projects')
    .select('id, user_id, status, original_file_path')
    .eq('id', projectId)
    .single()
  if (fetchErr || !project) {
    res.status(404).json({ error: 'project not found' })
    return
  }

  // Only recover a genuinely missing file — never overwrite a project that already has one.
  if (project.original_file_path) {
    res.status(409).json({ error: 'project already has a file' })
    return
  }

  // The uploaded object must live under this project's own folder (the client uploads to
  // `${userId}/${projectId}/original/...`). Reject anything pointing elsewhere.
  if (!path.startsWith(`${project.user_id}/${projectId}/`)) {
    res.status(400).json({ error: 'path does not belong to this project' })
    return
  }

  const update: { original_file_path: string; status: string; original_file_name?: string } = {
    original_file_path: path,
    status: 'pending',
  }
  if (fileName) update.original_file_name = fileName

  const { error: updErr } = await supabase.from('projects').update(update).eq('id', projectId)
  if (updErr) {
    res.status(500).json({ error: `status update failed: ${updErr.message}` })
    return
  }

  // Re-trigger the pipeline through the same concurrency-limited queue as /start.
  enqueueProcessing(projectId)
  res.json({ ok: true })
})

export default router
