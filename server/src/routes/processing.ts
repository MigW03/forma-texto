import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { stripe } from '../lib/stripe'
import { exportPdfBeside } from '../lib/processFormatting'
import { unzipDocx, zipDocx, finalizeInputs, detectPretextual, type PendingInput } from '../lib/formatting'
import { paginateSumario } from '../lib/paginateSumario'
import { sendProjectReadyEmail } from '../lib/notify'
import { processingLimiter } from '../lib/rateLimit'
import { enqueueProcessing } from '../lib/jobQueue'

const router = Router()

type AuthMode = 'secret' | 'owner' | null

/**
 * Authorize a processing trigger. Two accepted callers:
 *  1. Server-to-server / manual (curl, n8n): shared `x-webhook-secret` → 'secret'
 *     (trusted; skips the payment gate — used for manual retriggers/recovery).
 *  2. The frontend: a Supabase access token (Bearer) belonging to the project's
 *     owner → 'owner'. Prevents triggering processing on someone else's project,
 *     and is subject to the payment gate below.
 * Returns which path authorized (or null), so the caller can require payment only
 * for the untrusted owner path.
 */
async function authorize(req: Request, projectId: string): Promise<AuthMode> {
  const secret = process.env.WEBHOOK_SECRET
  if (secret && req.headers['x-webhook-secret'] === secret) return 'secret'

  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null

  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData.user) return null

  const { data: project } = await supabase
    .from('projects')
    .select('user_id')
    .eq('id', projectId)
    .single()
  return project && project.user_id === userData.user.id ? 'owner' : null
}

/**
 * Payment gate for the owner path: the project must be backed by a real payment,
 * otherwise any logged-in user could create a project and run the (paid) AI
 * pipeline for free. The project's `order_id` must point to an order that is
 * `paid` or `free_trial`, owned by the same user, AND that actually *covers* the
 * project — the client controls the project row (direct RLS insert), so it could
 * otherwise attach a 2-page order to a 500-page project (pay for 2, process 500)
 * or a proofreading-only order to a formatting+proofreading project. We require the
 * order's page_count/services to be a superset of what the project asks for.
 *
 * The Stripe webhook flips the order `pending → paid` asynchronously, so it may
 * not have landed yet when the client fires this right after payment. To stay
 * race-free we ask Stripe directly for a still-`pending` order and accept it if
 * the PaymentIntent already succeeded (opportunistically flipping our row).
 */
async function hasValidPayment(projectId: string): Promise<boolean> {
  const { data: project } = await supabase
    .from('projects')
    .select('user_id, order_id, page_count, services')
    .eq('id', projectId)
    .single()
  if (!project?.order_id) return false

  const { data: order } = await supabase
    .from('orders')
    .select('status, user_id, page_count, services, stripe_payment_intent_id')
    .eq('id', project.order_id)
    .single()
  if (!order || order.user_id !== project.user_id) return false

  // The order must cover the work: at least as many pages, and every requested
  // service. Guards against a small/cheap order being reattached to a bigger job.
  const projectPages = project.page_count ?? 0
  const orderPages = order.page_count ?? 0
  if (projectPages > orderPages) return false
  const orderServices = new Set((order.services ?? []) as string[])
  const projectServices = (project.services ?? []) as string[]
  if (!projectServices.every(s => orderServices.has(s))) return false

  if (order.status === 'paid' || order.status === 'free_trial') return true

  if (order.status === 'pending' && order.stripe_payment_intent_id) {
    try {
      const pi = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id)
      if (pi.status === 'succeeded') {
        await supabase.from('orders').update({ status: 'paid' }).eq('id', project.order_id)
        return true
      }
    } catch (err) {
      console.error('[processing] PaymentIntent verify failed:', err)
    }
  }
  return false
}

// POST /api/processing/start  { projectId }
// Kicks off the formatting pipeline in the background and returns immediately.
router.post('/start', processingLimiter, async (req: Request, res: Response) => {
  const { projectId } = req.body as { projectId?: string }
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }

  const mode = await authorize(req, projectId)
  if (!mode) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  // Owner-triggered runs must be backed by a real payment. The trusted secret path
  // (manual retrigger / recovery) is exempt.
  if (mode === 'owner' && !(await hasValidPayment(projectId))) {
    res.status(402).json({ error: 'Payment required' })
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

  const mode = await authorize(req, projectId)
  if (!mode) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  // Re-triggers the pipeline, so it needs the same payment gate as /start.
  if (mode === 'owner' && !(await hasValidPayment(projectId))) {
    res.status(402).json({ error: 'Payment required' })
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
