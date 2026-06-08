import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unzipDocx } from './docxZip'
import { applyStepA } from './applyStepA'
import { stepD } from './stepD'
import { getBlocks } from './blocks'
import { createHeadingDecider } from './ai/headingDecider'
import { loadAiConfig } from './ai/config'

/**
 * LIVE eval — calls the real model through OpenRouter. Off by default.
 * Run with:  RUN_AI_EVALS=1 OPENROUTER_API_KEY=sk-or-... npm test
 *
 * Checks the prompt actually produces good heading decisions on the broken
 * fixture (which has chapter titles typed as plain Normal paragraphs). Never
 * runs in CI — no key, no spend, no flakiness.
 */
const RUN = process.env.RUN_AI_EVALS === '1' && !!process.env.OPENROUTER_API_KEY

const countHeadings = (xml: string) =>
  (xml.match(/<w:pStyle\s+w:val="(?:Title|Heading[123])"\/>/g) ?? []).length

describe.skipIf(!RUN)('Step D live eval (real OpenRouter model)', () => {
  it('promotes plain-text headings in the fixture without losing blocks', async () => {
    const fixture = new URL('../../../test_assets/formatting_test_input.docx', import.meta.url)
    const buf = new Uint8Array(readFileSync(fixture))
    const { documentXml, stylesXml } = unzipDocx(buf)
    const a = applyStepA({ documentXml, stylesXml, guideline: 'abnt' })

    const before = a.documentXml
    const { documentXml: after } = await stepD(before, 'abnt', createHeadingDecider(loadAiConfig()))

    // Same number of body blocks — Step D only rewrites pStyle, never adds/drops blocks.
    expect(getBlocks(after)).toHaveLength(getBlocks(before).length)
    // The fixture hides headings as Normal text; a working prompt promotes at least one.
    expect(countHeadings(after)).toBeGreaterThan(countHeadings(before))

    console.log(`[eval] headings before=${countHeadings(before)} after=${countHeadings(after)} (model=${loadAiConfig().model})`)
  }, 60_000)
})
