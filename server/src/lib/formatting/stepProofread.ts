/**
 * Step P — proofreading (the AI pass that fixes grammar, punctuation, spelling,
 * verb-tense consistency, and ABNT in-text-citation format in the body text).
 *
 * Design (mirrors Steps C/D — see docs/formatting-pipeline.md):
 *  - The AI NEVER emits XML. It returns the CORRECTED plain text of each paragraph
 *    it changed — `[{ i, text }]` keyed by absolute block index. Deterministic code
 *    (`runs.ts`) diffs that against the original and maps each edit onto the run it
 *    falls inside, so the author's intentional formatting (bold/italic/links) and
 *    every untouched span survive byte-for-byte. An edit that would cross a run
 *    boundary leaves the whole paragraph unchanged — worst case is an UNCHANGED
 *    paragraph, never corrupted text.
 *  - The model is injected as a `ProofreadDecider` so the pass is testable offline
 *    with a fake (no network, no key, no spend).
 *
 * Scope (locked with the user): proofread headings, body, and list items. NEVER
 * touch the document title, the references section, tables, or captions. References
 * are excluded by `refStartIndex` (the orchestrator passes the located references
 * heading; in proofreading-only mode it auto-detects it). Runs AFTER the formatting
 * passes so heading classification (Step D) is already done — which lets us batch by
 * chapter (a new chunk starts at each `Heading1`).
 */
import { getBlocks, blockText, isParagraph, blockDescriptor, replaceBlocks } from './blocks'
import { paragraphText, spliceCorrectedText, canSpliceParagraph } from './runs'
import { CAPTION_STYLE } from './guidelines'
import type { Guideline } from './guidelines'

/** The compact shape the AI sees for one paragraph: its index and full current text. */
export interface ProofreadBlock {
  i: number
  text: string
}

/** One unit of work handed to the model: paragraphs to proofread + read-only context. */
export interface ProofreadChunk {
  chunkIndex: number
  totalChunks: number
  /** Last 1–2 heading texts seen before this chunk, for tense/consistency across a cut. */
  context: string[]
  guideline: Guideline
  blocks: ProofreadBlock[]
  /**
   * Set by the resilience wrapper on the LAST retry of a single stubborn paragraph. The
   * real decider responds by dropping the reasoning effort to `minimal` — over-reasoning
   * is the dominant failure mode (the model burns the whole token budget deliberating and
   * emits no JSON), so thinking less is the one knob that changes the outcome on an
   * identical retry.
   */
  escalated?: boolean
}

/** The model's answer for one paragraph: its corrected full text. */
export interface ProofreadDecision {
  i: number
  text: string
}

/** The model seam. Real impl calls OpenRouter; tests inject a deterministic fake. */
export interface ProofreadDecider {
  proofread(chunk: ProofreadChunk): Promise<ProofreadDecision[]>
}

export interface ChunkOptions {
  /** Index of the references heading; candidates at/after it are excluded. -1 = no references. */
  refStartIndex?: number
  /**
   * Block indices to never proofread — the pré-textual cover/identity pages (capa, folha
   * de rosto, folha de aprovação). Their text is institution names, author/examiner names,
   * the title, and dates: correcting any of it is wrong. The rest of the front matter
   * (resumo, abstract, agradecimentos, …) is NOT excluded and is proofread normally.
   */
  excludeIndices?: ReadonlySet<number>
  /** Compact-text budget per chunk. Keep well under the model's context window. */
  maxChars?: number
  /**
   * Max paragraphs per chunk, independent of the char budget. Many *short* lines (front
   * matter / TOC) all fit the char budget, so a char-only split packs dozens into one call —
   * a reasoning model then over-deliberates the whole batch and blows its token budget without
   * emitting JSON. Capping the count keeps each call small (cf. Step C `maxEntries`).
   */
  maxBlocks?: number
}

const DEFAULT_MAX_CHARS = 8000
const DEFAULT_MAX_BLOCKS = 12

const TITLE_STYLE = 'Title'

/** A block looks like a heading worth carrying in cross-chunk context. */
const looksLikeHeading = (style: string, bold: boolean, len: number) =>
  /heading/i.test(style) || (bold && len < 80)

/**
 * Split the document's proofread-able paragraphs into chunks under the char budget,
 * preferring to start a new chunk at each `Heading1` (chapter) boundary. Excludes the
 * title, captions, the references region (`refStartIndex`), tables, and any paragraph
 * that is unsafe to splice (hyperlinks/fields/footnotes). Headings, body, and list
 * items are all included.
 */
export function chunkProofread(
  documentXml: string,
  guideline: Guideline,
  { refStartIndex = -1, excludeIndices, maxChars = DEFAULT_MAX_CHARS, maxBlocks = DEFAULT_MAX_BLOCKS }: ChunkOptions = {},
): ProofreadChunk[] {
  const blocks = getBlocks(documentXml)
  const candidates = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => {
      if (!isParagraph(b) || blockText(b).length === 0) return false
      if (refStartIndex >= 0 && i >= refStartIndex) return false // references — never proofread
      if (excludeIndices?.has(i)) return false // cover/identity pages — names must not be "corrected"
      if (!canSpliceParagraph(b)) return false // hyperlink/field/footnote — too risky
      const style = blockDescriptor(b, i).style
      if (style === TITLE_STYLE || style === CAPTION_STYLE) return false // title + captions excluded
      return true
    })

  const packed: { blocks: ProofreadBlock[]; context: string[] }[] = []
  let cur: ProofreadBlock[] = []
  let size = 0
  const seenHeadings: string[] = []
  const flush = () => {
    if (cur.length) { packed.push({ blocks: cur, context: seenHeadings.slice(-2) }); cur = []; size = 0 }
  }

  for (const { b, i } of candidates) {
    const d = blockDescriptor(b, i)
    const text = paragraphText(b)
    const isChapterStart = d.style === 'Heading1'
    const cost = text.length + 40
    // New chunk at a chapter boundary, the char budget, or the paragraph-count cap.
    if (cur.length && (isChapterStart || size + cost > maxChars || cur.length >= maxBlocks)) flush()
    cur.push({ i, text })
    size += cost
    if (looksLikeHeading(d.style, d.bold, d.len)) seenHeadings.push(text.slice(0, 120))
  }
  flush()

  return packed.map((c, k) => ({
    chunkIndex: k,
    totalChunks: packed.length,
    context: c.context,
    guideline,
    blocks: c.blocks,
  }))
}

/**
 * Apply proofreading decisions to the original XML by absolute index. A paragraph is
 * rewritten only when its corrected text differs AND every edit maps cleanly onto a
 * run; otherwise it is left untouched (see `spliceCorrectedText`). Unknown indices are
 * ignored. Block count never changes, so the references region stays valid.
 */
export function applyProofreadDecisions(documentXml: string, decisions: ProofreadDecision[]): string {
  const textByIndex = new Map(decisions.map(d => [d.i, d.text]))
  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    const corrected = textByIndex.get(i)
    if (corrected === undefined) return
    const next = spliceCorrectedText(b, corrected)
    if (next && next !== b) byIndex.set(i, next)
  })
  return replaceBlocks(documentXml, byIndex)
}

export interface StepProofreadResult {
  documentXml: string
  /** Every decision the model returned, for logging/inspection. */
  decisions: ProofreadDecision[]
  /** Block indices that failed every retry and kept their deterministic text. */
  failedIndices: number[]
}

/**
 * Proofread one chunk, recovering from a model failure by splitting it into smaller
 * calls. A reasoning model can still blow its token budget on a chunk (emitting reasoning
 * but no JSON → `finishReason: length` → the decider throws), and on a long document one
 * such chunk would otherwise sink the whole pass. Instead we **isolate** the failure and,
 * if the chunk has more than one paragraph, **split it in half and retry each half** as its
 * own AI call — so an oversized/over-reasoned chunk becomes several tractable ones. A single
 * paragraph that still fails gets ONE escalated retry (reasoning effort `minimal` — see
 * `ProofreadChunk.escalated`) and is then skipped (it keeps its deterministic text); the
 * rest of the document is unaffected.
 */
async function proofreadResilient(
  decider: ProofreadDecider,
  chunk: ProofreadChunk,
  failed: number[],
): Promise<ProofreadDecision[]> {
  try {
    return await decider.proofread(chunk)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (chunk.blocks.length <= 1) {
      const i = chunk.blocks[0]?.i ?? -1
      if (!chunk.escalated) {
        console.warn(`[stepProofread] chunk ${chunk.chunkIndex} block ${i} failed, retrying with minimal reasoning: ${msg}`)
        return proofreadResilient(decider, { ...chunk, escalated: true }, failed)
      }
      console.warn(`[stepProofread] block ${i} failed after escalation, keeping deterministic text: ${msg}`)
      if (i >= 0) failed.push(i)
      return []
    }
    const mid = Math.ceil(chunk.blocks.length / 2)
    console.warn(`[stepProofread] chunk ${chunk.chunkIndex} (${chunk.blocks.length} blocks) failed, splitting and retrying: ${msg}`)
    const left = await proofreadResilient(decider, { ...chunk, blocks: chunk.blocks.slice(0, mid) }, failed)
    const right = await proofreadResilient(decider, { ...chunk, blocks: chunk.blocks.slice(mid) }, failed)
    return [...left, ...right]
  }
}

/**
 * Run Step P end to end: chunk → proofread each chunk via the injected decider →
 * apply all decisions. Returns the original XML unchanged (and no decisions) when
 * there is nothing to proofread. Each chunk is isolated and split-retried, so a single
 * failing chunk no longer discards the whole pass (see `proofreadResilient`).
 */
export async function stepProofread(
  documentXml: string,
  guideline: Guideline,
  decider: ProofreadDecider,
  opts: ChunkOptions = {},
): Promise<StepProofreadResult> {
  const chunks = chunkProofread(documentXml, guideline, opts)
  if (!chunks.length) return { documentXml, decisions: [], failedIndices: [] }

  const all: ProofreadDecision[] = []
  const failed: number[] = []
  for (const chunk of chunks) {
    all.push(...(await proofreadResilient(decider, chunk, failed)))
  }
  return { documentXml: applyProofreadDecisions(documentXml, all), decisions: all, failedIndices: failed }
}
