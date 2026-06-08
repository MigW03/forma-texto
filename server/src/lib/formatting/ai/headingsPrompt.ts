/**
 * Prompt assembly for Step D (heading reclassification).
 *
 * The guideline rules come from the spec file's §4 (the single source of truth),
 * so editing `specs/{id}.md` changes the prompt with no code change. The rules go
 * in the SYSTEM prompt (constant across a document's chunks → cacheable); only the
 * chunk data varies per call.
 */
import type { HeadingChunk } from '../stepD'
import type { Guideline } from '../guidelines'

export function buildHeadingSystemPrompt(section4: string, guideline: Guideline): string {
  return [
    `You classify paragraphs from an academic document formatted to the ${guideline.toUpperCase()} standard.`,
    `For each paragraph you are given, decide its role: "title", "h1", "h2", "h3", or "body".`,
    ``,
    `Many authors type headings as ordinary bold/large text instead of using heading styles.`,
    `Your job is to find those and assign the correct level. Cues for a heading:`,
    `- short line (not a full sentence/paragraph)`,
    `- a numeric prefix like "1", "1.1", "1.1.1", or "Capítulo 1"`,
    `- ALL CAPS, or bold with little text.`,
    ``,
    `Rules:`,
    `- Default to "body" whenever you are not confident. Leaving a paragraph as body is always safe.`,
    `- Do NOT guess the document title from position — documents often begin with front matter`,
    `  (cover, abstract, table of contents). Only use "title" if the text is unmistakably the work's title.`,
    `- Echo EVERY index "i" you are given exactly once, so no paragraph is left undecided.`,
    `- Use the level numbering from the guideline rules below to pick h1 vs h2 vs h3.`,
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
    .map(b => `{ "i": ${b.i}, "text": ${JSON.stringify(b.text)}, "style": ${JSON.stringify(b.style)}, "bold": ${b.bold}, "len": ${b.len} }`)
    .join('\n')
  return `${context}Classify these paragraphs. Return one decision per paragraph.\n\n${blocks}`
}
