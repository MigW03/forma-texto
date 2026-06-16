/**
 * Prompt assembly for Step P (proofreading).
 *
 * The task instructions live in `prompts/proofreading.md` (editable like a skill, no
 * code change). The guideline-SPECIFIC in-text citation rules come from the spec
 * file's §5 (the single source of truth). This builder combines the two into the
 * SYSTEM prompt (constant across a document's chunks → cacheable); only the chunk
 * data varies per call. The `{{GUIDELINE}}` token in the md is filled in here.
 */
import { loadPrompt, promptBody } from '../prompts'
import type { ProofreadChunk } from '../stepProofread'
import type { Guideline } from '../guidelines'

export function buildProofreadSystemPrompt(section5: string, guideline: Guideline): string {
  const instructions = promptBody(loadPrompt('proofreading')).replace(
    /\{\{GUIDELINE\}\}/g,
    guideline.toUpperCase(),
  )
  return [
    instructions,
    ``,
    `In-text citation rules (authoritative):`,
    section5 || '(no citation section provided)',
  ].join('\n')
}

export function buildProofreadUserPrompt(chunk: ProofreadChunk): string {
  const context =
    chunk.context.length > 0
      ? `Headings seen before this chunk (for context only, do not return these):\n${chunk.context.map(h => `- ${h}`).join('\n')}\n\n`
      : ''
  const blocks = chunk.blocks
    .map(b => `{ "i": ${b.i}, "text": ${JSON.stringify(b.text)} }`)
    .join('\n')
  return `${context}Proofread these paragraphs. Return one decision ONLY for each paragraph you change; omit the rest.\n\n${blocks}`
}
