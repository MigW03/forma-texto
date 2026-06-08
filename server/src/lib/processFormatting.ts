import { supabase } from './supabase'
import { sendProjectReadyEmail } from './notify'
import {
  unzipDocx,
  zipDocx,
  applyStepA,
  formatReferences,
  locateReferences,
  resolveGuideline,
  stepC,
  stepD,
  loadAiConfig,
  createHeadingDecider,
  createReferenceDecider,
  pageForBlock,
  getBlocks,
  blockText,
  type HeadingDecision,
  type ReferenceDecision,
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

const BUCKET = 'projects'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

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
 * Server-side DOCX formatting pipeline — Step A (deterministic) only.
 * Download → unzip → apply Step A → re-zip → upload → stamp `complete` → email.
 *
 * Designed to be called fire-and-forget; never throws past this boundary.
 * On failure it restores `status='pending'` so the project can be retried.
 */
export async function processFormatting(projectId: string): Promise<void> {
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

    // 2. Guard — only run when formatting is requested
    const services: string[] = project.services ?? []
    if (!services.includes('formatting')) {
      console.warn(`[processFormatting] ${projectId} has no 'formatting' service — skipping`)
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
    const a = applyStepA({ documentXml, stylesXml, guideline }) // Step A: styles, overrides, margins
    const refInput = {
      selectedPages: project.selected_pages ?? [],
      referencePages: project.references_pages ?? [],
    }
    const documentXmlB = formatReferences(a.documentXml, guideline, refInput) // Step B: references

    // Steps C & D (AI). Both are behind one feature flag, each wrapped on its own so
    // any AI failure keeps the deterministic A/B result — a paid job is never blocked
    // by the model. They share the references region: C reformats its entries, D uses
    // its heading index to exclude references from heading classification. Both pass
    // by absolute block index (count never changes), so the region stays valid across C.
    let documentXmlAI = documentXmlB
    const aiCfg = loadAiConfig()
    if (aiCfg.enabled) {
      const region = locateReferences(documentXmlB, refInput)

      // Diagnose why Step C might do nothing, so "references unchanged" is never
      // ambiguous in the logs: no page flagged vs flagged-but-not-located vs ran.
      if (refInput.referencePages.length === 0) {
        console.log(`[processFormatting] ${projectId} Step C: no references page flagged — skipping`)
      } else if (!region) {
        console.warn(`[processFormatting] ${projectId} Step C: references page(s) [${refInput.referencePages.join(', ')}] flagged but no references region located in the document`)
      } else {
        // Step C: reformat each reference entry into the guideline citation format.
        try {
          const result = await stepC(documentXmlAI, guideline, createReferenceDecider(aiCfg), region, {
            maxChars: aiCfg.maxCharsPerChunk,
          })
          documentXmlAI = result.documentXml
          console.log(`[processFormatting] ${projectId} Step C: located ${region.entryIndices.length} entr(ies), reformatted ${result.decisions.length}`)
          logReferences(projectId, result.decisions)
        } catch (err) {
          console.error(`[processFormatting] Step C failed for ${projectId} (non-fatal, keeping deterministic result):`, err)
        }
      }

      // Step D: reclassify headings typed as plain text.
      try {
        const result = await stepD(documentXmlAI, guideline, createHeadingDecider(aiCfg), {
          refStartIndex: region?.headingIdx ?? -1,
          maxChars: aiCfg.maxCharsPerChunk,
        })
        documentXmlAI = result.documentXml
        logHeadings(projectId, documentXmlAI, result.decisions, refInput.selectedPages)
      } catch (err) {
        console.error(`[processFormatting] Step D failed for ${projectId} (non-fatal, keeping deterministic result):`, err)
      }
    }

    const out = { documentXml: documentXmlAI, stylesXml: a.stylesXml }
    const docxBuf = zipDocx(files, out)

    // 6. Upload processed .docx
    const processedPath = `${project.user_id}/${projectId}/processed/${processedName(project.original_file_name)}`
    const { error: upError } = await supabase.storage
      .from(BUCKET)
      .upload(processedPath, docxBuf, { contentType: DOCX_MIME, upsert: true })
    if (upError) throw new Error(`upload failed: ${upError.message}`)

    // 7. Stamp complete (frontend gates download on status === 'complete')
    const { error: updError } = await supabase
      .from('projects')
      .update({
        processed_file_path: processedPath,
        status: 'complete',
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

    console.log(`[processFormatting] done: ${projectId} -> ${processedPath}`)
  } catch (err) {
    console.error(`[processFormatting] FAILED ${projectId}:`, err)
    // restore to pending so it can be retried
    await supabase
      .from('projects')
      .update({ status: 'pending' })
      .eq('id', projectId)
      .then(undefined, () => {})
  }
}
