import { supabase } from './supabase'
import { sendProjectReadyEmail, sendReuploadNeededEmail } from './notify'
import { docxToPdf } from './docxToPdf'
import { paginateSumario } from './paginateSumario'
import {
  unzipDocx,
  zipDocx,
  applyStepA,
  formatReferences,
  formatCaptions,
  formatImages,
  formatLongQuotes,
  normalizeFontPackaging,
  setRunFonts,
  setHeadingRunProps,
  suppressFirstHeadingPageBreak,
  removeRedundantChapterPageBreaks,
  normalizeNumberingXml,
  locateReferences,
  autoLocateReferences,
  locateAppendixStart,
  detectPretextual,
  applyPretextualHeadings,
  applyCoverAlignment,
  applyFolhaRostoAlignment,
  applyPretextualPageBreaks,
  applyCoverVerticalDistribution,
  applyAbntPageNumbering,
  coverBlockIndices,
  resolveGuideline,
  getGuideline,
  stepC,
  stepD,
  stepProofread,
  loadAiConfig,
  applyPunctNormWithStats,
  isNoopPunct,
  createHeadingDecider,
  createReferenceDecider,
  createProofreadDecider,
  isRateLimitError,
  pageForBlock,
  getBlocks,
  blockText,
  detectAndInsertPlaceholders,
  buildSumario,
  bodyStartForPageNumbering,
  demoteImplausibleHeadings,
  applyHeadingNumbering,
  validateOutput,
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

/**
 * Export a PDF beside the processed .docx (same path, `.pdf` extension) and upload it.
 * Non-fatal by contract: a missing/broken LibreOffice is logged and swallowed here, so
 * the .docx (the primary deliverable) always ships. Call this only when the document is
 * FINAL — i.e. when stamping `complete`. A `needs_input` doc must NOT get a PDF yet: the
 * red caption/source placeholders would be baked into it; the PDF is generated from the
 * user-completed document at finalize time instead.
 */
export async function exportPdfBeside(docxBuf: Buffer, processedPath: string, projectId: string): Promise<void> {
  try {
    const pdfBuf = await docxToPdf(docxBuf)
    const pdfPath = processedPath.replace(/\.docx$/i, '.pdf')
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, pdfBuf, { contentType: PDF_MIME, upsert: true })
    if (error) throw new Error(error.message)
    console.log(`[exportPdfBeside] ${projectId} -> ${pdfPath}`)
  } catch (err) {
    console.error(`[exportPdfBeside] pdf export failed for ${projectId} (non-fatal):`, err)
  }
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
    // Missing-file recovery: a paid order can land with no file (the upload lives in
    // volatile browser memory and a payment-redirect reload / refresh can wipe it before
    // the post-payment upload runs). Instead of silently aborting, mark the project
    // `missing_file` and email the user to re-upload (no re-charge — see recover-file route).
    if (!project.original_file_path) {
      console.warn(`[processFormatting] ${projectId} has no original_file_path — flagging missing_file`)
      if (project.status !== 'missing_file') {
        await supabase.from('projects').update({ status: 'missing_file' }).eq('id', projectId)
        try {
          await sendReuploadNeededEmail(projectId)
        } catch (err) {
          console.error(`[processFormatting] reupload email failed for ${projectId} (non-fatal):`, err)
        }
      }
      return
    }

    // 3. Mark processing. processing_started_at is a heartbeat consumed by
    // recoverStuckJobs() to detect a job orphaned by a server crash/restart.
    await supabase.from('projects').update({ status: 'processing', processing_started_at: new Date().toISOString() }).eq('id', projectId)

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
    const aiCfg = loadAiConfig()

    // Working document/styles, mutated step by step. Proofreading-only projects skip
    // the formatting passes entirely (we never reformat a doc the user didn't pay to
    // format) and only run Step P over the original text.
    let workingDocXml = documentXml
    let workingStylesXml = stylesXml
    let pending: PendingInput[] = []
    // The one font family Step A resolved (formatting only). Used at the very end to stamp
    // an explicit font on every run so Google Docs — which ignores inherited style fonts on
    // its remapped built-in styles — renders the right family everywhere.
    let resolvedFont: string | null = null
    // The located references region — shared by Steps C/D and used by Step P to skip
    // references. Stays null in proofreading-only mode (Step P auto-detects instead).
    let region: ReferenceRegion | null = null

    if (doFormatting) {
      // Compact list indentation before anything else so Step A + AI passes see the
      // normalized numbering. Word defaults to 720 twips/level — we drop it to 480.
      const NUMBERING_PATH = 'word/numbering.xml'
      if (files[NUMBERING_PATH]) {
        const numXml = Buffer.from(files[NUMBERING_PATH]).toString('utf-8')
        files[NUMBERING_PATH] = Buffer.from(normalizeNumberingXml(numXml), 'utf-8')
      }
      // Locate the appendix/annex section (if any). It IS formatted and proofread now
      // (billed like the rest), so its headings get the correct hierarchy and its text is
      // corrected. The ONLY thing skipped there is image handling — an annex reproduces
      // third-party documents (forms, maps) whose images carry no caption/source of ours
      // and must not be rescaled. So `appendixStart` gates only the three image passes
      // below; every text/heading pass treats the section like the rest of the document.
      const appendixStart = locateAppendixStart(workingDocXml)
      if (appendixStart !== null) {
        console.log(`[processFormatting] ${projectId} appendix/annex detected at block ${appendixStart} — formatted/proofread, but image passes (resize/caption/source) skipped`)
      }

      // Long (block) quotations (NBR 10520) — tag the author's already-blocked quotes and
      // over-long inline quotations with the LongQuote style BEFORE Step A, which strips the
      // direct `<w:ind>` that is one of the detection signals. The style then carries the
      // block geometry. Frozen in the appendix/annex (a reproduced document isn't re-blocked).
      workingDocXml = formatLongQuotes(workingDocXml, appendixStart ?? Infinity)

      const a = applyStepA({ documentXml: workingDocXml, stylesXml: workingStylesXml, guideline }) // Step A
      workingStylesXml = a.stylesXml
      resolvedFont = a.font
      // Normalize the font packaging (theme major/minor + drop orphaned embedded fonts) to
      // the family Step A resolved — styles alone don't control what Google Docs renders.
      normalizeFontPackaging(files, a.font)
      workingDocXml = formatReferences(a.documentXml, guideline, refInput) // Step B: references
      region = locateReferences(workingDocXml, refInput)

      // Correct paragraphs the author left in a Title/Heading style by mistake (typed a
      // subheading, then kept typing body prose in the same style without switching back
      // to Normal). Deterministic, always runs — the AI heading pass (Step D) only ever
      // promotes, never demotes, by design, so this is the only place that can fix it.
      // Runs before pré-textual detection/Step D so neither sees the bogus heading.
      const beforeDemote = workingDocXml
      workingDocXml = demoteImplausibleHeadings(workingDocXml)
      if (workingDocXml !== beforeDemote) {
        console.log(`[processFormatting] ${projectId} demoted implausibly long heading-styled paragraph(s) back to body text`)
      }

      // Pré-textual front matter (capa, folha de rosto, resumo, abstract, sumário, listas,
      // agradecimentos, …). Each labeled heading gets the ABNT unnumbered-title style
      // (centered, bold, UPPERCASE) deterministically; `bodyStart` then excludes the whole
      // region from Step D so a cover/abstract line is never promoted to a numbered heading.
      // The capa↔folha split is heuristic — correct cover layout/generation is future work.
      const pretextual = detectPretextual(workingDocXml)
      if (pretextual.bodyStart > 0) {
        workingDocXml = applyPretextualHeadings(workingDocXml, pretextual.sections)
        workingDocXml = applyCoverAlignment(workingDocXml, pretextual.sections)
        workingDocXml = applyFolhaRostoAlignment(workingDocXml, pretextual.sections)
        workingDocXml = applyPretextualPageBreaks(workingDocXml, pretextual.sections)
        console.log(`[processFormatting] ${projectId} pré-textuais: [${pretextual.sections.map(s => s.kind).join(', ')}] — body starts at block ${pretextual.bodyStart}`)
      }

      // Steps C & D (AI), behind the formatting flag, each wrapped on its own so any AI
      // failure keeps the deterministic A/B result — a paid job is never blocked by the
      // model. They share the references region: C reformats its entries, D uses its
      // heading index to exclude references. Both act by absolute block index (count
      // never changes), so the region stays valid across C.
      if (aiCfg.enabled) {
        // Diagnose why Step C might do nothing, so "references unchanged" is never
        // ambiguous in the logs: no page flagged vs flagged-but-not-located vs ran.
        if (refInput.referencePages.length === 0) {
          console.log(`[processFormatting] ${projectId} Step C: no references page flagged — skipping`)
        } else if (!region) {
          const isContinuous = refInput.referencePages.length === 1 && refInput.referencePages[0] === 0
          if (isContinuous) {
            console.log(`[processFormatting] ${projectId} Step C: continuous mode — references heading not found in document, skipping`)
          } else {
            console.warn(`[processFormatting] ${projectId} Step C: references page(s) [${refInput.referencePages.join(', ')}] flagged but no references region located in the document`)
          }
        } else {
          // Step C: reformat each reference entry into the guideline citation format.
          try {
            const cStart = Date.now()
            console.log(`[processFormatting] ${projectId} Step C: calling model (${aiCfg.referenceModel}) on ${region.entryIndices.length} entr(ies)…`)
            const result = await stepC(workingDocXml, guideline, createReferenceDecider(aiCfg), region, {
              maxChars: aiCfg.maxCharsPerChunk,
              maxEntries: aiCfg.referencesMaxEntries,
            })
            workingDocXml = result.documentXml
            console.log(`[processFormatting] ${projectId} Step C: located ${region.entryIndices.length} entr(ies), reformatted ${result.decisions.length} (${since(cStart)})`)
            if (result.failedIndices.length > 0) {
              console.warn(`[processFormatting] ${projectId} Step C: ${result.failedIndices.length} entr(ies) failed every retry (kept Step B layout): [${result.failedIndices.join(', ')}]`)
            }
            logReferences(projectId, result.decisions)
          } catch (err) {
            if (isRateLimitError(err)) throw err // abort the whole job to a retriable state (see outer catch)
            console.error(`[processFormatting] Step C failed for ${projectId} (non-fatal, keeping deterministic result):`, err)
          }
        }

        // Step D: reclassify headings typed as plain text.
        try {
          const dStart = Date.now()
          console.log(`[processFormatting] ${projectId} Step D: calling model (${aiCfg.headingModel})…`)
          const result = await stepD(workingDocXml, guideline, createHeadingDecider(aiCfg), {
            // Exclude only the references region [refHeading, appendixStart); the appendix
            // that follows references is re-included so its headings get classified.
            refStartIndex: region?.headingIdx ?? -1,
            appendixStartIndex: appendixStart ?? -1,
            bodyStartIndex: pretextual.bodyStart,
            maxChars: aiCfg.maxCharsPerChunk,
            maxBlocks: aiCfg.maxBlocksPerChunk,
          })
          workingDocXml = result.documentXml
          console.log(`[processFormatting] ${projectId} Step D: ${result.decisions.length} paragraph(s) classified (${since(dStart)})`)
          if (result.failedIndices.length > 0) {
            console.warn(`[processFormatting] ${projectId} Step D: ${result.failedIndices.length} block(s) failed every retry (kept deterministic style): [${result.failedIndices.join(', ')}]`)
          }
          logHeadings(projectId, workingDocXml, result.decisions, refInput.selectedPages)
        } catch (err) {
          if (isRateLimitError(err)) throw err // abort the whole job to a retriable state (see outer catch)
          console.error(`[processFormatting] Step D failed for ${projectId} (non-fatal, keeping deterministic result):`, err)
        }
      }

      // Heading numbering (ABNT NBR 6024): renumber every Heading1/2/3 paragraph
      // sequentially (1, 1.1, 1.1.1, …), regardless of what — or whether — the author
      // typed a number. Runs after Step D so it sees every promoted heading, and
      // before the sumário rebuild so TOC entries carry the same numbers. The
      // appendix/annex (letter-labeled, e.g. "APÊNDICE A") is excluded even if Step D
      // happened to style one Heading1 — it is not part of the chapter sequence.
      workingDocXml = applyHeadingNumbering(workingDocXml, {
        bodyStartIndex: pretextual.bodyStart,
        stopIndex: appendixStart ?? undefined,
      })

      // Sumário: rebuild the table of contents from Heading1–3 paragraphs in the body.
      // Runs after Step D so it sees all classified headings. Page numbers are left blank
      // (set to a tab with dot leader but no number) — a future render pass will fill them.
      // Block count may change, so appendixStart is recomputed before the caption passes.
      workingDocXml = buildSumario(workingDocXml, pretextual)
      const finalAppendixStart = locateAppendixStart(workingDocXml)
      if (finalAppendixStart !== appendixStart) {
        console.log(`[processFormatting] ${projectId} appendixStart shifted ${appendixStart} → ${finalAppendixStart} after sumário rebuild`)
      }

      // Final deterministic touches, after the AI passes so they see the final heading
      // styles: (1) constrain inline image size + center; (2) image captions;
      // (3) cancel the page break before the FIRST H1. Image sizing runs over the WHOLE
      // document — an oversized image overflows the page even in the appendix/annex, so it
      // must be capped there too (it only shrinks overflow, never forces a size). Caption /
      // source insertion still stops at the appendix (we don't caption reproduced documents).
      const captionFreezeAt = finalAppendixStart ?? Infinity
      workingDocXml = formatImages(workingDocXml, guideline)
      workingDocXml = formatCaptions(workingDocXml, captionFreezeAt)
      // Only suppress the first H1 page break when the doc starts with H1 directly
      // (no front matter). If pré-textuais exist, INTRODUÇÃO needs its own page.
      if (pretextual.bodyStart === 0) workingDocXml = suppressFirstHeadingPageBreak(workingDocXml)
      // Drop the author's manual page break before chapter titles — the Heading1 style
      // already breaks, and the double break renders a blank page in the PDF (LibreOffice).
      workingDocXml = removeRedundantChapterPageBreaks(workingDocXml)
      const { xml: docWithPlaceholders, pending: detected } = detectAndInsertPlaceholders(workingDocXml, captionFreezeAt)
      workingDocXml = docWithPlaceholders
      pending = detected
    }

    // Proofreading. Step Punct (deterministic) always runs first when proofreading is
    // requested — it normalises spacing/punctuation so the AI sees clean text and can
    // focus on grammar. It belongs to the proofreading service, so a format-only doc
    // keeps the author's punctuation untouched. Step P (AI) follows when enabled. Both
    // proofread the appendix/annex too — only the references region is excluded.
    if (doProofreading) {
      const punctStart = Date.now()
      const { xml: punctXml, stats } = applyPunctNormWithStats(workingDocXml) // Step Punct
      workingDocXml = punctXml
      if (isNoopPunct(stats)) {
        console.log(`[processFormatting] ${projectId} Step Punct: no changes (${since(punctStart)})`)
      } else {
        console.log(
          `[processFormatting] ${projectId} Step Punct: ` +
          `${stats.doubleSpaces} double-space, ${stats.spaceBeforePunct} space-before-punct, ` +
          `${stats.spaceAfterPunct} space-after-punct, ${stats.smartQuotes} smart-quote, ` +
          `${stats.ellipsis} ellipsis, ${stats.emDashes} em-dash, ${stats.nbsp} nbsp, ` +
          `${stats.crossRunTrims} cross-run-trim (${since(punctStart)})`,
        )
      }
    }

    // Step P (AI proofreading) — runs after formatting so it sees the classified
    // headings and can batch by chapter. References are excluded by the located region
    // when formatting ran, else auto-detected by heading text. Non-fatal: a failure
    // keeps the prior result. Toggled independently via AI_PROOFREADING_ENABLED.
    if (doProofreading && aiCfg.proofreadingEnabled) {
      try {
        const refHeading = (region ?? autoLocateReferences(workingDocXml))?.headingIdx
        const refStart = refHeading ?? -1 // appendix is proofread now; only references are excluded
        // Never proofread the cover/identity pages (capa, folha de rosto, folha de aprovação) —
        // correcting names/institution/title is wrong. Detected fresh so it also applies in
        // proofreading-only mode (where the formatting passes, and their detection, are skipped).
        // The rest of the front matter (resumo, abstract, …) is proofread normally.
        const coverExclude = coverBlockIndices(detectPretextual(workingDocXml).sections)
        const pStart = Date.now()
        const preDocXml = workingDocXml
        console.log(`[processFormatting] ${projectId} Step P: calling model (${aiCfg.proofreadModel})…`)
        const result = await stepProofread(workingDocXml, guideline, createProofreadDecider(aiCfg), {
          refStartIndex: refStart,
          excludeIndices: coverExclude,
          maxChars: aiCfg.maxCharsPerChunk,
          maxBlocks: aiCfg.maxBlocksPerChunk,
        })
        workingDocXml = result.documentXml
        console.log(`[processFormatting] ${projectId} Step P: ${result.decisions.length} paragraph(s) corrected (${since(pStart)})`)
        if (result.failedIndices.length > 0) {
          console.warn(`[processFormatting] ${projectId} Step P: ${result.failedIndices.length} block(s) failed every retry (kept deterministic text): [${result.failedIndices.join(', ')}]`)
        }
        logProofread(projectId, preDocXml, result.decisions)
      } catch (err) {
        if (isRateLimitError(err)) throw err // abort the whole job to a retriable state (see outer catch)
        console.error(`[processFormatting] Step P failed for ${projectId} (non-fatal, keeping prior result):`, err)
      }
    }

    // Vertically center the capa within the page (institution/title/author/city/year as
    // one block, rather than clumped at the top). Collapses the capa's paragraphs into a
    // single table block (see `applyCoverVerticalDistribution`'s doc comment for why —
    // table-cell vAlign is the one OOXML vertical-alignment mechanism LibreOffice actually
    // honors), so it MUST run after every block-index-dependent pass above (Step C/D/P,
    // sumário, captions/placeholders) — re-detects pré-textuais fresh rather than reusing
    // the `pretextual` computed earlier, which is now stale (Step D/sumário can shift
    // indices). Formatting only; a proofreading-only doc never touches the cover.
    if (doFormatting) {
      workingDocXml = applyCoverVerticalDistribution(workingDocXml, detectPretextual(workingDocXml).sections)
      // ABNT NBR 14724: every page from the folha de rosto onward counts toward the
      // total, but the printed page number stays hidden through the WHOLE pré-textual
      // region — visible only from the textual part (Introdução) onward. Splits the
      // document into a hidden front section + a numbered body section (real OOXML
      // section break, not just a first-page-only flag) and registers a new header
      // part with a right-aligned PAGE field. The correct start value isn't knowable
      // until the document is rendered — `paginateSumario` (below) resolves the
      // placeholder it stamps, in the same render pass as the sumário's own numbers.
      // Independent of the table-based vertical distribution above; does not touch it.
      // The sumário's own TOC entries read like body headings once numbered (e.g.
      // "1 INTRODUÇÃO"), so a fresh `detectPretextual` here can land `bodyStart` on the
      // FIRST TOC entry — which would drop the section break between the SUMÁRIO label
      // and its entries, splitting the title onto its own page. `bodyStartForPageNumbering`
      // anchors past the sumário's structurally-identified entry run.
      const detectedBodyStart = detectPretextual(workingDocXml).bodyStart
      const numberingBodyStart = bodyStartForPageNumbering(workingDocXml, detectedBodyStart)
      if (resolvedFont) {
        workingDocXml = applyAbntPageNumbering(workingDocXml, files, numberingBodyStart, resolvedFont)
      }
    }

    // Stamp the resolved family on every run as the LAST document transform (after Steps
    // C/D/P, which add their own runs) so Google Docs renders the right font everywhere —
    // it ignores inherited style fonts on its remapped built-in styles. Formatting only;
    // a proofreading-only doc keeps the author's fonts.
    if (resolvedFont) {
      workingDocXml = setRunFonts(workingDocXml, resolvedFont)
      // Same Google Docs quirk for heading size/bold/caps: it discards the inherited
      // Heading1/2/3 style rPr (headings import smaller + lose uppercase). Stamp the
      // per-level look directly on heading runs. Must follow setRunFonts (keeps rPr
      // order valid). Formatting only.
      workingDocXml = setHeadingRunProps(workingDocXml, getGuideline(guideline))
    }

    // Sumário pagination + ABNT header page-number resolution — THE LAST content
    // transform, by contract: it renders the final document (LibreOffice → PDF),
    // reads which page each heading landed on, stamps the sumário entries, and
    // resolves the placeholder header page-number start from `applyAbntPageNumbering`
    // above. Anything running after it could shift pages and stale the numbers.
    // Skipped for needs_input docs (the red placeholders inflate the layout); the
    // finalize-inputs route paginates instead, after the user's fills produce the
    // real final document. Non-fatal — a failure leaves the numbers blank/placeholder.
    if (doFormatting && pending.length === 0) {
      const finalPretextual = detectPretextual(workingDocXml)
      workingDocXml = await paginateSumario(files, workingDocXml, workingStylesXml, projectId, {
        sections: finalPretextual.sections,
        bodyStart: finalPretextual.bodyStart,
      })

      // Output-validation backstop: independent of whether the AI passes succeeded,
      // catch the deterministic-bug class (malformed XML, a sumário/heading-count
      // mismatch, an unresolved page-number placeholder, a flagged-but-not-located
      // references page) before this document ever reaches a paying user. A failure
      // here throws — same retriable-to-`pending` path as any other pipeline error
      // (see the outer catch) — rather than stamping `complete` on a silently-broken doc.
      const issues = validateOutput(workingDocXml, {
        pretextual: finalPretextual,
        referencesFlagged: refInput.referencePages.length > 0,
        referenceRegion: region,
      })
      if (issues.length > 0) {
        throw new Error(`output validation failed: ${issues.map(i => `${i.code}: ${i.message}`).join('; ')}`)
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

    // 7. Stamp status. If the pipeline detected missing captions/sources, stamp
    // needs_input and store the pending list so the user can fill them — no PDF yet
    // (it would bake in the red placeholders; the finalize route exports it once the
    // user completes the doc). Otherwise the doc is final: export the PDF beside the
    // .docx, stamp complete, and send the ready email.
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
      // Final document — export the PDF beside the .docx before stamping complete, so the
      // client sees a ready PDF the moment it signs the URL on the complete transition.
      await exportPdfBeside(docxBuf, processedPath, projectId)

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
    // A rate limit is not a failure — the AI passes hit the provider's cap (e.g.
    // OpenRouter's free-tier 50/day) and aborted BEFORE stamping `complete` or uploading
    // a partial doc, exactly so a half-processed file never ships. Requeue to `pending`
    // and let a retry (manual `/api/processing/start`, or the pending-retry cron) run it
    // again once quota is available — same terminal state as a genuine error, but logged
    // as an expected requeue, not an error.
    if (isRateLimitError(err)) {
      console.warn(`[processFormatting] ${projectId} rate-limited by the AI provider after ${since(startedAt)} — requeued as 'pending' (no partial output shipped, will retry when quota is available)`)
    } else {
      console.error(`[processFormatting] FAILED ${projectId} (after ${since(startedAt)}):`, err)
    }
    // restore to pending so it can be retried
    await supabase
      .from('projects')
      .update({ status: 'pending' })
      .eq('id', projectId)
      .then(undefined, () => {})
  }
}
