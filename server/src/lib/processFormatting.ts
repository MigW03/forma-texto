import { supabase } from './supabase'
import { sendProjectReadyEmail } from './notify'
import { docxToPdf } from './docxToPdf'
import {
  unzipDocx,
  zipDocx,
  applyStepA,
  formatReferences,
  formatCaptions,
  formatImages,
  suppressFirstHeadingPageBreak,
  normalizeNumberingXml,
  locateReferences,
  autoLocateReferences,
  resolveGuideline,
  stepC,
  stepD,
  stepProofread,
  loadAiConfig,
  applyPunctNorm,
  createHeadingDecider,
  createReferenceDecider,
  createProofreadDecider,
  pageForBlock,
  getBlocks,
  blockText,
  detectAndInsertPlaceholders,
  type HeadingDecision,
  type ReferenceDecision,
  type ProofreadDecision,
  type ReferenceRegion,
  type PendingInput,
} from './formatting'

/** Tier label for a heading role, e.g. 'h2' → 'H2', 'title' → 'TITLE'. */
const tierLabel = (role: string) => role.toUpperCase()

/**
 * Log each identified heading on its own line: tier + page + text. Page is the
 * 1-based virtual page within the processed doc, mapped back to the user's
 * original page number when `selectedPages` is available.
 */
function logHeadings(projectId: string, documentXml: string, decisions: HeadingDecision[], selectedPages: number[]): void {
  const heads = decisions.filter(d => d.role !== 'body').sort((a, b) => a.i - b.i)
  console.log(`[processFormatting] ${projectId} Step D: ${heads.length} heading(s) identified`)
  if (heads.length === 0) return

  const pageOf = pageForBlock(documentXml)
  const blocks = getBlocks(documentXml)
  const sortedPages = [...selectedPages].sort((a, b) => a - b)
  for (const h of heads) {
    const virtualPage = pageOf[h.i] ?? 1
    const page = sortedPages[virtualPage - 1] ?? virtualPage // map to original page when known
    const text = blockText(blocks[h.i] ?? '').slice(0, 80)
    console.log(`[Step D]   ${tierLabel(h.role).padEnd(5)} page ${page}  "${text}"`)
  }
}

/**
 * Log each reformatted reference entry as the model returned it, with emphasis
 * made visible (`**bold**`, `_italic_`). Lets us see the raw Step C decision —
 * field order, punctuation, and which span was bolded — without opening the docx.
 */
function logReferences(projectId: string, decisions: ReferenceDecision[]): void {
  console.log(`[processFormatting] ${projectId} Step C: ${decisions.length} entr(ies) returned by the model`)
  for (const d of decisions) {
    const rendered = d.segments
      .map(s => (s.emphasis === 'bold' ? `**${s.text}**` : s.emphasis === 'italic' ? `_${s.text}_` : s.text))
      .join('')
    const emph = d.segments.filter(s => s.emphasis).length
    console.log(`[Step C]   #${d.i} (${emph} emphasis run(s)): ${rendered}`)
  }
}

/**
 * Log each proofreading change as `#i: "before" → "after"` so the edits are visible
 * without opening the docx. `before` is read from the pre-proofread document.
 */
function logProofread(projectId: string, preDocXml: string, decisions: ProofreadDecision[]): void {
  console.log(`[processFormatting] ${projectId} Step P: ${decisions.length} paragraph(s) changed by the model`)
  const blocks = getBlocks(preDocXml)
  for (const d of decisions) {
    const before = blockText(blocks[d.i] ?? '').slice(0, 80)
    const after = d.text.slice(0, 80)
    console.log(`[Step P]   #${d.i}: "${before}" → "${after}"`)
  }
}

const BUCKET = 'projects'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PDF_MIME = 'application/pdf'

/** Human-readable elapsed time since `start` (ms epoch), e.g. "1.4s" / "850ms". */
const since = (start: number) => {
  const ms = Date.now() - start
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

/** Make a storage-safe filename: strip accents, collapse whitespace, force .docx. */
function processedName(originalFileName: string | null): string {
  const base = (originalFileName ?? 'document')
    .replace(/\.(docx|zip)$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
  return `${base}.docx`
}

/**
 * Server-side DOCX pipeline for the formatting and/or proofreading services.
 * Download → unzip → [formatting: A→B→C→D + captions/page-break] → [proofreading:
 * Step P] → re-zip → upload → stamp `complete` → email. Each service runs only when
 * requested; proofreading-only projects skip the formatting passes entirely.
 *
 * Designed to be called fire-and-forget; never throws past this boundary.
 * On failure it restores `status='pending'` so the project can be retried.
 */
export async function processFormatting(projectId: string): Promise<void> {
  const startedAt = Date.now()
  try {
    // 1. Fetch project
    const { data: project, error: fetchError } = await supabase
      .from('projects')
      .select('id, user_id, original_file_path, original_file_name, services, guideline, status, selected_pages, references_pages')
      .eq('id', projectId)
      .single()

    if (fetchError || !project) {
      console.error(`[processFormatting] project not found: ${projectId}`, fetchError)
      return
    }

    // 2. Guard — run when formatting and/or proofreading is requested
    const services: string[] = project.services ?? []
    const doFormatting = services.includes('formatting')
    const doProofreading = services.includes('proofreading')
    if (!doFormatting && !doProofreading) {
      console.warn(`[processFormatting] ${projectId} has no 'formatting'/'proofreading' service — skipping`)
      return
    }
    if (!project.original_file_path) {
      console.error(`[processFormatting] ${projectId} has no original_file_path`)
      return
    }

    // 3. Mark processing
    await supabase.from('projects').update({ status: 'processing' }).eq('id', projectId)

    // 4. Download original (.zip-renamed docx)
    const { data: blob, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(project.original_file_path)
    if (dlError || !blob) {
      throw new Error(`download failed: ${dlError?.message ?? 'no data'}`)
    }
    const inputBuf = new Uint8Array(await blob.arrayBuffer())

    // 5. Transform
    const guideline = resolveGuideline(project.guideline)
    const { files, documentXml, stylesXml } = unzipDocx(inputBuf)
    const refInput = {
      selectedPages: project.selected_pages ?? [],
      referencePages: project.references_pages ?? [],
    }
    const documentXmlB = formatReferences(a.documentXml, guideline, refInput) // Step B: references
    const documentXmlP = applyPunctNorm(documentXmlB) // Step Punct: deterministic text normalisation

    // Steps C & D (AI). Both are behind one feature flag, each wrapped on its own so
    // any AI failure keeps the deterministic A/B result — a paid job is never blocked
    // by the model. They share the references region: C reformats its entries, D uses
    // its heading index to exclude references from heading classification. Both pass
    // by absolute block index (count never changes), so the region stays valid across C.
    let documentXmlAI = documentXmlP
    const aiCfg = loadAiConfig()
    if (aiCfg.enabled) {
      const region = locateReferences(documentXmlP, refInput)

      // Diagnose why Step C might do nothing, so "references unchanged" is never
      // ambiguous in the logs: no page flagged vs flagged-but-not-located vs ran.
      if (refInput.referencePages.length === 0) {
        console.log(`[processFormatting] ${projectId} Step C: no references page flagged — skipping`)
      } else if (!region) {
        console.warn(`[processFormatting] ${projectId} Step C: references page(s) [${refInput.referencePages.join(', ')}] flagged but no references region located in the document`)
      } else {
        // Step C: reformat each reference entry into the guideline citation format.
        try {
          const dStart = Date.now()
          console.log(`[processFormatting] ${projectId} Step D: calling model (${aiCfg.headingModel})…`)
          const result = await stepD(workingDocXml, guideline, createHeadingDecider(aiCfg), {
            refStartIndex: region?.headingIdx ?? -1,
            maxChars: aiCfg.maxCharsPerChunk,
          })
          workingDocXml = result.documentXml
          console.log(`[processFormatting] ${projectId} Step D: ${result.decisions.length} paragraph(s) classified (${since(dStart)})`)
          logHeadings(projectId, workingDocXml, result.decisions, refInput.selectedPages)
        } catch (err) {
          console.error(`[processFormatting] Step D failed for ${projectId} (non-fatal, keeping deterministic result):`, err)
        }
      }

      // Final deterministic touches, after the AI passes so they see the final heading
      // styles: (1) normalize inline image size/centering; (2) image captions;
      // (3) cancel the page break before the FIRST H1.
      workingDocXml = formatImages(workingDocXml, guideline)
      workingDocXml = formatCaptions(workingDocXml)
      workingDocXml = suppressFirstHeadingPageBreak(workingDocXml)
      const { xml: docWithPlaceholders, pending: detected } = detectAndInsertPlaceholders(workingDocXml)
      workingDocXml = docWithPlaceholders
      pending = detected
    }

    // Step P (AI proofreading) — runs after formatting so it sees the classified
    // headings and can batch by chapter. References are excluded by the located region
    // when formatting ran, else auto-detected by heading text. Non-fatal: a failure
    // keeps the prior result. Toggled independently via AI_PROOFREADING_ENABLED.
    if (doProofreading && aiCfg.proofreadingEnabled) {
      try {
        const refStart = (region ?? autoLocateReferences(workingDocXml))?.headingIdx ?? -1
        const pStart = Date.now()
        const preDocXml = workingDocXml
        console.log(`[processFormatting] ${projectId} Step P: calling model (${aiCfg.proofreadModel})…`)
        const result = await stepProofread(workingDocXml, guideline, createProofreadDecider(aiCfg), {
          refStartIndex: refStart,
          maxChars: aiCfg.maxCharsPerChunk,
        })
        workingDocXml = result.documentXml
        console.log(`[processFormatting] ${projectId} Step P: ${result.decisions.length} paragraph(s) corrected (${since(pStart)})`)
        logProofread(projectId, preDocXml, result.decisions)
      } catch (err) {
        console.error(`[processFormatting] Step P failed for ${projectId} (non-fatal, keeping prior result):`, err)
      }
    }

    const out = { documentXml: workingDocXml, stylesXml: workingStylesXml }
    const docxBuf = zipDocx(files, out)

    // 6. Upload processed .docx. cacheControl is a real TTL so the CDN can serve
    // repeat views fast; staleness after an overwrite is handled client-side by
    // keying the URL on `completed_at` (changes on every content write), not by
    // disabling caching.
    const processedPath = `${project.user_id}/${projectId}/processed/${processedName(project.original_file_name)}`
    const { error: upError } = await supabase.storage
      .from(BUCKET)
      .upload(processedPath, docxBuf, { contentType: DOCX_MIME, upsert: true, cacheControl: '3600' })
    if (upError) throw new Error(`upload failed: ${upError.message}`)

    // 6b. PDF export alongside the .docx (non-fatal — the .docx is the primary
    // deliverable; a missing/broken LibreOffice must not fail the whole job).
    // Stored at the same path with a .pdf extension; the frontend derives it.
    try {
      const pdfBuf = await docxToPdf(docxBuf)
      const pdfPath = processedPath.replace(/\.docx$/i, '.pdf')
      const { error: pdfUpError } = await supabase.storage
        .from(BUCKET)
        .upload(pdfPath, pdfBuf, { contentType: PDF_MIME, upsert: true })
      if (pdfUpError) throw new Error(pdfUpError.message)
      console.log(`[processFormatting] pdf export: ${projectId} -> ${pdfPath}`)
    } catch (err) {
      console.error(`[processFormatting] pdf export failed for ${projectId} (non-fatal):`, err)
    }

    // 7. Stamp status. If the pipeline detected missing captions/sources, stamp
    // needs_input and store the pending list so the user can fill them. Otherwise
    // stamp complete immediately and send the ready email.
    if (pending.length > 0) {
      const { error: updError } = await supabase
        .from('projects')
        .update({
          processed_file_path: processedPath,
          status: 'needs_input',
          pending_inputs: pending,
          completed_at: null,
        })
        .eq('id', projectId)
      if (updError) throw new Error(`status update failed: ${updError.message}`)
      console.log(`[processFormatting] ${projectId} → needs_input (${pending.length} placeholder(s))`)
    } else {
      const { error: updError } = await supabase
        .from('projects')
        .update({
          processed_file_path: processedPath,
          status: 'complete',
          pending_inputs: null,
          completed_at: new Date().toISOString(),
        })
        .eq('id', projectId)
      if (updError) throw new Error(`status update failed: ${updError.message}`)

      // 8. Notify (non-fatal)
      try {
        await sendProjectReadyEmail(projectId)
      } catch (err) {
        console.error(`[processFormatting] email failed for ${projectId} (non-fatal):`, err)
      }
    }

    console.log(`[processFormatting] done: ${projectId} -> ${processedPath} (total ${since(startedAt)})`)
  } catch (err) {
    console.error(`[processFormatting] FAILED ${projectId} (after ${since(startedAt)}):`, err)
    // restore to pending so it can be retried
    await supabase
      .from('projects')
      .update({ status: 'pending' })
      .eq('id', projectId)
      .then(undefined, () => {})
  }
}
