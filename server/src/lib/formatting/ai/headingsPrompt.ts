/**
 * Prompt assembly for Step D (heading reclassification).
 *
 * The task instructions live in `prompts/heading-classification.md` (editable like
 * a skill, no code change). The guideline-SPECIFIC rules come from the spec file's
 * §4 (the single source of truth). This builder combines the two into the SYSTEM
 * prompt (constant across a document's chunks → cacheable); only the chunk data
 * varies per call. The `{{GUIDELINE}}` token in the md is filled in here.
 */
import { loadPrompt, promptBody } from '../prompts'
import type { HeadingChunk } from '../stepD'
import type { Guideline } from '../guidelines'

export function buildHeadingSystemPrompt(section4: string, guideline: Guideline): string {
  const instructions = promptBody(loadPrompt('heading-classification')).replace(
    /\{\{GUIDELINE\}\}/g,
    guideline.toUpperCase(),
  )
  return [
    instructions,
    ``,
    `Guideline rules (authoritative):`,
    section4 || '(no section provided)',
  ].join('\n')
}

export function buildHeadingUserPrompt(chunk: HeadingChunk): string {
  const context =
    chunk.context.length > 0
      ? `Headings seen before this chunk (for level context only, do not reclassify these):\n${chunk.context.map(h => `- ${h}`).join('\n')}\n\n`
      : ''
  const blocks = chunk.blocks
    .map(b => {
      const fields = [
        `"i": ${b.i}`,
        `"text": ${JSON.stringify(b.text)}`,
        `"style": ${JSON.stringify(b.style)}`,
        `"bold": ${b.bold}`,
        `"len": ${b.len}`,
      ]
      if (b.atPageStart) fields.push(`"atPageStart": true`) // soft h1 cue; absent = not at a page start
      return `{ ${fields.join(', ')} }`
    })
    .join('\n')
  return `${context}Classify these paragraphs. Return one decision per paragraph.\n\n${blocks}`
}
