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
}

const DEFAULT_MAX_CHARS = 8000

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const EMPHASIS_RPR: Record<NonNullable<ReferenceSegment['emphasis']>, string> = {
  bold: '<w:rPr><w:b/></w:rPr>',
  italic: '<w:rPr><w:i/></w:rPr>',
}

/**
 * Render segments into `<w:r>` runs. Empty-text segments are dropped. Returns ''
 * when nothing renders (the caller then leaves the entry untouched).
 * `xml:space="preserve"` keeps the spaces that separate citation fields.
 */
export function renderSegments(segments: ReferenceSegment[]): string {
  return segments
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
  { maxChars = DEFAULT_MAX_CHARS }: ChunkOptions = {},
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
    if (size + cost > maxChars && cur.length) {
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
}

/**
 * Run Step C end to end: chunk the references region → reformat each chunk via the
 * injected decider → apply all decisions. Returns the original XML unchanged (and
 * no decisions) when there is no references region to reformat. Throws only if the
 * decider throws — the orchestrator wraps this call so an AI failure keeps the
 * deterministic A/B result.
 */
export async function stepC(
  documentXml: string,
  guideline: Guideline,
  decider: ReferenceDecider,
  region: ReferenceRegion | null,
  opts: ChunkOptions = {},
): Promise<StepCResult> {
  const chunks = chunkReferences(documentXml, guideline, region, opts)
  if (!chunks.length) return { documentXml, decisions: [] }

  const all: ReferenceDecision[] = []
  for (const chunk of chunks) {
    all.push(...(await decider.reformat(chunk)))
  }
  return { documentXml: applyReferenceDecisions(documentXml, all), decisions: all }
}
