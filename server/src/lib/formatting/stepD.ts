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
import { getBlocks, blockText, isParagraph, isListItem, blockDescriptor, setParagraphStyle, replaceBlocks, type BlockDescriptor } from './blocks'
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
  /**
   * Index of the first appendix/annex block. The references region is only
   * `[refStartIndex, appendixStartIndex)` — the appendix comes AFTER references in ABNT
   * order, so without this it would be swept up by the references cutoff and never
   * classified. Candidates at/after this index are re-included. -1 = no appendix.
   */
  appendixStartIndex?: number
  /**
   * First body block index — the pré-textual region `[0, bodyStartIndex)` (capa, folha
   * de rosto, resumo, sumário, …) is excluded so the model never promotes a cover or
   * abstract line to a numbered heading. Those labeled headings get their own
   * unnumbered-title style deterministically (`applyPretextualHeadings`). 0 = none.
   */
  bodyStartIndex?: number
  /** Compact-text budget per chunk. Keep well under the model's context window. */
  maxChars?: number
  /**
   * Max paragraphs per chunk, independent of the char budget. Front matter / TOC are many
   * *short* lines that all fit the char budget, so a char-only split packs dozens into one
   * call — a reasoning model then over-deliberates the whole batch and blows its token budget
   * without emitting JSON. Capping the count keeps each call small (cf. Step C `maxEntries`).
   */
  maxBlocks?: number
}

const DEFAULT_MAX_CHARS = 8000
const DEFAULT_MAX_BLOCKS = 12

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
  { refStartIndex = -1, appendixStartIndex = -1, bodyStartIndex = 0, maxChars = DEFAULT_MAX_CHARS, maxBlocks = DEFAULT_MAX_BLOCKS }: ChunkOptions = {},
): HeadingChunk[] {
  const blocks = getBlocks(documentXml)
  const candidates = blocks
    .map((b, i) => ({ b, i }))
    // List items are never headings: a numbered list item ("1. Lorem ipsum") is
    // indistinguishable from a numbered heading ("1. Introdução") by text alone,
    // and promoting one breaks the list's numbering. Exclude them up front.
    // The references region is only [refStartIndex, appendixStartIndex): exclude it, but
    // re-include the appendix/annex that follows references so its headings are classified.
    .filter(({ b, i }) => {
      if (!isParagraph(b) || isListItem(b) || blockText(b).length === 0) return false
      if (i < bodyStartIndex) return false // pré-textual front matter — never a body heading
      const toc = b.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? ''
      if (/^toc[\s\d]/i.test(toc)) return false // Word auto-TOC entries — never a body heading
      const beforeRefs = refStartIndex < 0 || i < refStartIndex
      const inAppendix = appendixStartIndex >= 0 && i >= appendixStartIndex
      return beforeRefs || inAppendix
    })

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
    if (cur.length && (size + cost > maxChars || cur.length >= maxBlocks)) {
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
    if (isListItem(b)) return // never promote a list item — would break its numbering
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
