/**
 * Step D — heading reclassification (the AI pass that finds paragraphs typed as
 * ordinary text that are really section headings, and assigns the right level).
 *
 * Design (see formattingPlan-stepsCD.md):
 *  - The AI NEVER emits XML. It returns decisions only — `[{ i, role }]` keyed by
 *    absolute block index. Deterministic code applies them by rewriting `<w:pStyle>`
 *    on the ORIGINAL XML. Worst case of a bad answer = one wrong heading level,
 *    never corrupted text.
 *  - The model is injected as a `HeadingDecider` so the pass is testable offline
 *    with a fake (no network, no key, no spend). The real OpenRouter decider lives
 *    in `ai/` and is passed in at the orchestrator.
 *  - `body` means LEAVE AS-IS (conservative): Step D only PROMOTES misclassified
 *    headings; it does not demote. A paragraph the model is unsure about defaults
 *    to `body` and is never touched.
 */
import { getBlocks, blockText, isParagraph, blockDescriptor, setParagraphStyle, replaceBlocks, type BlockDescriptor } from './blocks'
import { pageForBlock } from './references'
import type { Guideline } from './guidelines'

export type HeadingRole = 'title' | 'h1' | 'h2' | 'h3' | 'body'

/** One unit of work handed to the model: descriptors + read-only cross-chunk context. */
export interface HeadingChunk {
  chunkIndex: number
  totalChunks: number
  /** Last 1–2 heading texts seen before this chunk, so a level decision survives a mid-document cut. */
  context: string[]
  guideline: Guideline
  blocks: BlockDescriptor[]
}

/** The model's answer for one block. */
export interface HeadingDecision {
  i: number
  role: HeadingRole
}

/** The model seam. Real impl calls OpenRouter; tests inject a deterministic fake. */
export interface HeadingDecider {
  classify(chunk: HeadingChunk): Promise<HeadingDecision[]>
}

/** Role → Word style id. `body` is absent because it is a no-op (leave as-is). */
const ROLE_STYLE: Record<Exclude<HeadingRole, 'body'>, string> = {
  title: 'Title',
  h1: 'Heading1',
  h2: 'Heading2',
  h3: 'Heading3',
}

export interface ChunkOptions {
  /** Index of the references heading; candidates at/after it are excluded. -1 = no references. */
  refStartIndex?: number
  /** Compact-text budget per chunk. Keep well under the model's context window. */
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 8000

/** A block looks like a heading worth carrying in cross-chunk context. */
const looksLikeHeading = (d: BlockDescriptor) => /heading/i.test(d.style) || (d.bold && d.len < 80)

/**
 * Split the document's body paragraphs (excluding the references section) into
 * chunks under the char budget. Each chunk carries the last 1–2 heading texts
 * seen before it as read-only context.
 */
export function chunkHeadings(
  documentXml: string,
  guideline: Guideline,
  { refStartIndex = -1, maxChars = DEFAULT_MAX_CHARS }: ChunkOptions = {},
): HeadingChunk[] {
  const blocks = getBlocks(documentXml)
  const candidates = blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => isParagraph(b) && blockText(b).length > 0 && (refStartIndex < 0 || i < refStartIndex))

  // First non-empty paragraph on each page → a soft h1 cue the model can weigh.
  const pageOf = pageForBlock(documentXml)
  const pageStart = new Set<number>()
  let seenPage = -1
  for (const { i } of candidates) {
    const pg = pageOf[i] ?? 1
    if (pg !== seenPage) { pageStart.add(i); seenPage = pg }
  }

  const packed: { blocks: BlockDescriptor[]; context: string[] }[] = []
  let cur: BlockDescriptor[] = []
  let size = 0
  const seenHeadings: string[] = []

  for (const { b, i } of candidates) {
    const d = blockDescriptor(b, i)
    if (pageStart.has(i)) d.atPageStart = true
    const cost = d.text.length + 40
    if (size + cost > maxChars && cur.length) {
      packed.push({ blocks: cur, context: seenHeadings.slice(-2) })
      cur = []
      size = 0
    }
    cur.push(d)
    size += cost
    if (looksLikeHeading(d)) seenHeadings.push(d.text)
  }
  if (cur.length) packed.push({ blocks: cur, context: seenHeadings.slice(-2) })

  return packed.map((c, k) => ({
    chunkIndex: k,
    totalChunks: packed.length,
    context: c.context,
    guideline,
    blocks: c.blocks,
  }))
}

/**
 * Apply heading decisions to the original XML by absolute index. Only `title/h1/h2/h3`
 * act (rewrite `<w:pStyle>`); `body` and unknown indices are left untouched.
 */
export function applyHeadingDecisions(documentXml: string, decisions: HeadingDecision[]): string {
  const roleByIndex = new Map(decisions.map(d => [d.i, d.role]))
  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    const role = roleByIndex.get(i)
    if (!role || role === 'body') return // conservative: only promote, never demote
    byIndex.set(i, setParagraphStyle(b, ROLE_STYLE[role]))
  })
  return replaceBlocks(documentXml, byIndex)
}

export interface StepDResult {
  documentXml: string
  /** Every decision the model returned (including `body`), for logging/inspection. */
  decisions: HeadingDecision[]
}

/**
 * Run Step D end to end: chunk → classify each chunk via the injected decider →
 * apply all decisions. Returns the original XML unchanged (and no decisions) when
 * there is nothing to classify. Throws only if the decider throws — the
 * orchestrator wraps this call so an AI failure keeps the deterministic A/B result.
 */
export async function stepD(
  documentXml: string,
  guideline: Guideline,
  decider: HeadingDecider,
  opts: ChunkOptions = {},
): Promise<StepDResult> {
  const chunks = chunkHeadings(documentXml, guideline, opts)
  if (!chunks.length) return { documentXml, decisions: [] }

  const all: HeadingDecision[] = []
  for (const chunk of chunks) {
    all.push(...(await decider.classify(chunk)))
  }
  return { documentXml: applyHeadingDecisions(documentXml, all), decisions: all }
}
