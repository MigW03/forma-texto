/**
 * Step C — reference reformatting (the AI pass that rewrites each reference entry
 * into the guideline's citation format, e.g. ABNT NBR 6023).
 *
 * Design (mirrors Step D — see docs/formatting-pipeline.md):
 *  - The AI NEVER emits XML. It returns decisions only — `[{ i, segments }]` keyed
 *    by absolute block index. Deterministic code renders the segments into `<w:r>`
 *    runs (emphasis → `<w:b/>`/`<w:i/>`) and splices them over the entry paragraph,
 *    preserving the `<w:pPr>` that Step B already set. Worst case of a bad answer =
 *    one unchanged or oddly-split entry, never corrupted text or an unopenable file.
 *  - The model is injected as a `ReferenceDecider` so the pass is testable offline
 *    with a fake (no network, no key, no spend). The real OpenRouter decider lives
 *    in `ai/` and is passed in at the orchestrator.
 *  - An entry with no usable segments is LEFT AS-IS (conservative): Step C only
 *    rewrites an entry when the model returns content for it; an empty or missing
 *    answer keeps the deterministic Step B layout.
 *
 * Scope: Step C only touches the entry paragraphs of the references region
 * (`ReferenceRegion.entryIndices`); the section heading and the whole body are
 * untouched. References are located by the user-flagged pages, never by scanning
 * for "Referências" — see `locateReferences` in references.ts.
 */
import { getBlocks, blockText, replaceBlocks } from './blocks'
import { escapeXml } from './xmlText'
import { isRateLimitError } from './ai/retry'
import type { ReferenceRegion } from './references'
import type { Guideline } from './guidelines'

/** A run of text within a reformatted entry, with optional emphasis. */
export interface ReferenceSegment {
  text: string
  /** Emphasis to apply to this run. Absent = plain text. */
  emphasis?: 'bold' | 'italic'
}

/** One unit of work handed to the model: the reference entries to reformat. */
export interface ReferenceChunk {
  chunkIndex: number
  totalChunks: number
  guideline: Guideline
  entries: ReferenceEntry[]
  /**
   * Set by the resilience wrapper on the LAST retry of a single stubborn entry. The real
   * decider responds by dropping the reasoning effort to `minimal` — over-reasoning is the
   * dominant failure mode (reasoning tokens but no JSON), so thinking less is the one knob
   * that changes the outcome on an identical retry.
   */
  escalated?: boolean
}

/** The compact shape the AI sees for one entry: its index and full current text. */
export interface ReferenceEntry {
  i: number
  text: string
}

/** The model's answer for one entry: the reformatted text split into emphasis runs. */
export interface ReferenceDecision {
  i: number
  segments: ReferenceSegment[]
}

/** The model seam. Real impl calls OpenRouter; tests inject a deterministic fake. */
export interface ReferenceDecider {
  reformat(chunk: ReferenceChunk): Promise<ReferenceDecision[]>
}

export interface ChunkOptions {
  /** Compact-text budget per chunk. Keep well under the model's context window. */
  maxChars?: number
  /**
   * Hard cap on entries per chunk. References are short, so the char budget alone
   * packs all of them into one call — but a reasoning model handed 10 entries at
   * once over-reasons and returns only a few (observed: 10 sent, 1 back, finished
   * cleanly having burned ~8k tokens). Small batches keep each call tractable and
   * make the count deterministic. Independent of `maxChars`, whichever trips first.
   */
  maxEntries?: number
}

const DEFAULT_MAX_CHARS = 8000
const DEFAULT_MAX_ENTRIES = 3

const EMPHASIS_RPR: Record<NonNullable<ReferenceSegment['emphasis']>, string> = {
  bold: '<w:rPr><w:b/></w:rPr>',
  italic: '<w:rPr><w:i/></w:rPr>',
}

/**
 * Normalize a reference segment's text before it becomes a run:
 *  1. Decode HTML/XML entities the model sometimes pre-emits — it occasionally returns a
 *     URL as `&lt;...&gt;`. Without decoding, `escapeXml` escapes the `&` again and the
 *     document shows a literal `&lt;` / `&gt;`.
 *  2. Strip the angle brackets some authors wrap a URL in. ABNT NBR 6023:2018 dropped them
 *     ("Disponível em: URL."), and removing them makes `<url>` and a bare `url` format
 *     identically — two otherwise-equal references no longer diverge.
 */
export function normalizeReferenceText(text: string): string {
  const decoded = text
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&') // last, so we don't re-decode an already-decoded entity
  // Drop < > that merely wrap a URL (with any surrounding whitespace).
  return decoded.replace(/<\s*(https?:\/\/[^>\s]+)\s*>/gi, '$1')
}

/**
 * Render segments into `<w:r>` runs. Empty-text segments are dropped. Returns ''
 * when nothing renders (the caller then leaves the entry untouched).
 * `xml:space="preserve"` keeps the spaces that separate citation fields.
 */
export function renderSegments(segments: ReferenceSegment[]): string {
  return segments
    .map(s => ({ ...s, text: normalizeReferenceText(s.text) }))
    .filter(s => s.text.length > 0)
    .map(s => {
      const rPr = s.emphasis ? EMPHASIS_RPR[s.emphasis] : ''
      return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(s.text)}</w:t></w:r>`
    })
    .join('')
}

/**
 * Replace a paragraph's run content with `runsXml`, keeping its opening `<w:p>`
 * tag (rsids, paraId) and its `<w:pPr>` (the entry layout Step B applied). Returns
 * the paragraph unchanged for a self-closed `<w:p/>` or when `runsXml` is empty.
 */
export function setParagraphRuns(p: string, runsXml: string): string {
  if (!runsXml) return p
  if (/^<w:p\b[^>]*\/>/.test(p)) return p // self-closed <w:p/> — nothing to reformat
  const open = p.match(/^<w:p\b[^>]*>/)
  if (!open) return p
  const pPr = p.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>|<w:pPr\b[^>]*\/>/)
  return `${open[0]}${pPr ? pPr[0] : ''}${runsXml}</w:p>`
}

/**
 * Split the references region's entry paragraphs into chunks under the char budget.
 * Each entry is independent (unlike headings, no cross-chunk context is needed).
 * Returns no chunks when there is no references region or it has no entries.
 */
export function chunkReferences(
  documentXml: string,
  guideline: Guideline,
  region: ReferenceRegion | null,
  { maxChars = DEFAULT_MAX_CHARS, maxEntries = DEFAULT_MAX_ENTRIES }: ChunkOptions = {},
): ReferenceChunk[] {
  if (!region || region.entryIndices.length === 0) return []
  const blocks = getBlocks(documentXml)
  const entries = region.entryIndices
    .map(i => ({ i, text: blockText(blocks[i] ?? '') }))
    .filter(e => e.text.length > 0)
  if (entries.length === 0) return []

  const packed: ReferenceEntry[][] = []
  let cur: ReferenceEntry[] = []
  let size = 0
  for (const e of entries) {
    const cost = e.text.length + 40
    // Break on either limit — entry cap (keeps batches small for reasoning models)
    // or char budget — whichever trips first.
    if ((cur.length >= maxEntries || size + cost > maxChars) && cur.length) {
      packed.push(cur)
      cur = []
      size = 0
    }
    cur.push(e)
    size += cost
  }
  if (cur.length) packed.push(cur)

  return packed.map((entries, k) => ({
    chunkIndex: k,
    totalChunks: packed.length,
    guideline,
    entries,
  }))
}

/**
 * Apply reformatting decisions to the original XML by absolute index. An entry is
 * rewritten only when its decision renders to at least one run; an empty/missing
 * decision (or an unknown index) leaves the deterministic Step B entry untouched.
 */
export function applyReferenceDecisions(documentXml: string, decisions: ReferenceDecision[]): string {
  const segmentsByIndex = new Map(decisions.map(d => [d.i, d.segments]))
  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    const segments = segmentsByIndex.get(i)
    if (!segments) return
    const runs = renderSegments(segments)
    if (!runs) return // conservative: no usable segments → keep the Step B entry
    byIndex.set(i, setParagraphRuns(b, runs))
  })
  return replaceBlocks(documentXml, byIndex)
}

export interface StepCResult {
  documentXml: string
  /** Every decision the model returned, for logging/inspection. */
  decisions: ReferenceDecision[]
  /** Entry block indices that failed every retry and kept their Step B layout. */
  failedIndices: number[]
}

/**
 * Reformat one chunk, recovering from a model failure by splitting it into smaller
 * calls (mirrors Step D/P). A multi-entry chunk that fails is split in half and each
 * half retried as its own AI call; a single entry that still fails gets ONE escalated
 * retry (reasoning effort `minimal`) and is then skipped — it keeps the deterministic
 * Step B layout, and the rest of the references are unaffected.
 */
async function reformatResilient(
  decider: ReferenceDecider,
  chunk: ReferenceChunk,
  failed: number[],
): Promise<ReferenceDecision[]> {
  try {
    return await decider.reformat(chunk)
  } catch (err) {
    // A rate limit is account-wide and sticky — fail fast so the orchestrator requeues
    // the whole job instead of splitting into more calls that all 429.
    if (isRateLimitError(err)) throw err
    const msg = err instanceof Error ? err.message : String(err)
    if (chunk.entries.length <= 1) {
      const i = chunk.entries[0]?.i ?? -1
      if (!chunk.escalated) {
        console.warn(`[stepC] chunk ${chunk.chunkIndex} entry ${i} failed, retrying with minimal reasoning: ${msg}`)
        return reformatResilient(decider, { ...chunk, escalated: true }, failed)
      }
      console.warn(`[stepC] entry ${i} failed after escalation, keeping Step B layout: ${msg}`)
      if (i >= 0) failed.push(i)
      return []
    }
    const mid = Math.ceil(chunk.entries.length / 2)
    console.warn(`[stepC] chunk ${chunk.chunkIndex} (${chunk.entries.length} entries) failed, splitting and retrying: ${msg}`)
    const left = await reformatResilient(decider, { ...chunk, entries: chunk.entries.slice(0, mid) }, failed)
    const right = await reformatResilient(decider, { ...chunk, entries: chunk.entries.slice(mid) }, failed)
    return [...left, ...right]
  }
}

/**
 * Run Step C end to end: chunk the references region → reformat each chunk via the
 * injected decider → apply all decisions. Returns the original XML unchanged (and
 * no decisions) when there is no references region to reformat. Each chunk is
 * isolated and split-retried, so a single failing chunk no longer discards the whole
 * pass (see `reformatResilient`).
 */
export async function stepC(
  documentXml: string,
  guideline: Guideline,
  decider: ReferenceDecider,
  region: ReferenceRegion | null,
  opts: ChunkOptions = {},
): Promise<StepCResult> {
  const chunks = chunkReferences(documentXml, guideline, region, opts)
  if (!chunks.length) return { documentXml, decisions: [], failedIndices: [] }

  const all: ReferenceDecision[] = []
  const failed: number[] = []
  for (const chunk of chunks) {
    all.push(...(await reformatResilient(decider, chunk, failed)))
  }
  return { documentXml: applyReferenceDecisions(documentXml, all), decisions: all, failedIndices: failed }
}
