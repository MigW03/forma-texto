import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { unzipDocx } from './docxZip'
import { applyStepA } from './applyStepA'
import { formatReferences, locateReferences } from './references'
import { stepC } from './stepC'
import { getBlocks } from './blocks'
import { createReferenceDecider } from './ai/referencesDecider'
import { loadAiConfig } from './ai/config'

/**
 * LIVE eval — calls the real model through OpenRouter. Off by default.
 * Run with:  RUN_AI_EVALS=1 OPENROUTER_API_KEY=sk-or-... npm test
 *
 * Checks the Step C prompt actually reformats reference entries (emphasising the
 * work's title) without losing blocks or text. Never runs in CI — no key, no
 * spend, no flakiness.
 *
 * Note: the fixture's references pages are assumed here. Adjust selectedPages /
 * referencePages to the fixture if this skips for lack of a located region.
 */
const RUN = process.env.RUN_AI_EVALS === '1' && !!process.env.OPENROUTER_API_KEY

const countBold = (xml: string, idxs: number[]) => {
  const blocks = getBlocks(xml)
  return idxs.filter(i => /<w:b\/>/.test(blocks[i] ?? '')).length
}

describe.skipIf(!RUN)('Step C live eval (real OpenRouter model)', () => {
  it('reformats reference entries without losing blocks', async () => {
    const fixture = new URL('../../../test_assets/formatting_test_input.docx', import.meta.url)
    const buf = new Uint8Array(readFileSync(fixture))
    const { documentXml, stylesXml } = unzipDocx(buf)
    const a = applyStepA({ documentXml, stylesXml, guideline: 'abnt' })

    // The fixture is a single document; treat its last page as references for the eval.
    const refInput = { selectedPages: [1, 2, 3, 4, 5], referencePages: [5] }
    const before = formatReferences(a.documentXml, 'abnt', refInput)
    const region = locateReferences(before, refInput)
    if (!region || region.entryIndices.length === 0) {
      console.warn('[eval] no references region located in fixture — adjust refInput; skipping assertions')
      return
    }

    const { documentXml: after, decisions } = await stepC(before, 'abnt', createReferenceDecider(loadAiConfig()), region)

    // Same number of blocks — Step C only rewrites entry runs, never adds/drops blocks.
    expect(getBlocks(after)).toHaveLength(getBlocks(before).length)
    // A working prompt bolds the title of at least one entry.
    expect(countBold(after, region.entryIndices)).toBeGreaterThan(0)

    console.log(`[eval] entries reformatted=${decisions.length} bolded=${countBold(after, region.entryIndices)} (model=${loadAiConfig().model})`)
  }, 60_000)
})
