/**
 * Prompt assembly for Step C (reference reformatting).
 *
 * The task instructions live in `prompts/reference-reformatting.md` (editable like
 * a skill, no code change). The guideline-SPECIFIC rules + examples come from the
 * spec file's §6 (references rules) and §7 (worked examples) — the single source of
 * truth. This builder combines them into the SYSTEM prompt (constant across a
 * document's chunks → cacheable); only the chunk's entries vary per call. The
 * `{{GUIDELINE}}` token in the md is filled in here.
 */
import { loadPrompt, promptBody } from '../prompts'
import type { ReferenceChunk } from '../stepC'
import type { Guideline } from '../guidelines'

export function buildReferenceSystemPrompt(section6: string, section7: string, guideline: Guideline): string {
  const instructions = promptBody(loadPrompt('reference-reformatting')).replace(
    /\{\{GUIDELINE\}\}/g,
    guideline.toUpperCase(),
  )
  return [
    instructions,
    ``,
    `Guideline rules (authoritative):`,
    section6 || '(no rules section provided)',
    ``,
    `Reference examples (authoritative templates):`,
    section7 || '(no examples section provided)',
  ].join('\n')
}

export function buildReferenceUserPrompt(chunk: ReferenceChunk): string {
  const entries = chunk.entries
    .map(e => `{ "i": ${e.i}, "text": ${JSON.stringify(e.text)} }`)
    .join('\n')
  return `Reformat these reference entries. Return one decision per entry.\n\n${entries}`
}
