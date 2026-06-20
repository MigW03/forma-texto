import { describe, it, expect } from 'vitest'
import { stepProofread } from './stepProofread'
import { getBlocks, blockText } from './blocks'
import { autoLocateReferences } from './references'
import { createProofreadDecider } from './ai/proofreadDecider'
import { loadAiConfig } from './ai/config'

/**
 * LIVE eval — calls the real model through OpenRouter. Off by default.
 * Run with:  RUN_AI_EVALS=1 AI_PROOFREADING_ENABLED=1 OPENROUTER_API_KEY=sk-or-... \
 *            npx vitest run src/lib/formatting/proofread.eval.test.ts
 *
 * Checks the prompt actually fixes grammar/tense/citation errors WITHOUT touching the
 * references section, the document title, or losing any block. Never runs in CI.
 */
const RUN = process.env.RUN_AI_EVALS === '1' && !!process.env.OPENROUTER_API_KEY

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (inner: string, pPr = '') => `<w:p>${pPr}${inner}</w:p>`
const styled = (style: string, text: string) =>
  para(run(text), `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`)

// A short Portuguese doc with deliberate errors + a references section that must stay put.
// Errors: subject–verb agreement ("Os aluno fizeram"), accent ("metodo"), upper-cased
// citation ("(SILVA, 2020)"), spacing before a colon.
const BODY1 = 'Os aluno fizeram a pesquisa utilizando o metodo cientifico (SILVA, 2020).'
const BODY2 = 'A revisão de literatura foi conduzida de forma sistemática , conforme os autores.'
const REF_ENTRY = 'SILVA, João. Metodologia da pesquisa. São Paulo: Atlas, 2020.'

const DOC =
  `<w:document><w:body>` +
  styled('Title', 'O Título do Trabalho') +     // 0 — must not change
  styled('Heading1', 'Introdução') +            // 1
  para(run(BODY1)) +                            // 2 — should be corrected
  para(run(BODY2)) +                            // 3 — should be corrected
  styled('ReferencesHeading', 'REFERÊNCIAS') +  // 4 — references heading
  para(run(REF_ENTRY)) +                        // 5 — reference entry, must not change
  `</w:body></w:document>`

describe.skipIf(!RUN)('Step P live eval (real OpenRouter model)', () => {
  it('corrects body grammar without touching references, title, or block count', async () => {
    const refStart = autoLocateReferences(DOC)?.headingIdx ?? -1
    const { documentXml: after, decisions } = await stepProofread(
      DOC,
      'abnt',
      createProofreadDecider(loadAiConfig()),
      { refStartIndex: refStart },
    )

    const before = getBlocks(DOC)
    const out = getBlocks(after)
    expect(out).toHaveLength(before.length) // never adds/drops blocks
    expect(decisions.length).toBeGreaterThan(0) // the prompt found at least one error

    // References entry and title are off-limits — must be byte-for-byte identical.
    expect(out[5]).toBe(before[5])
    expect(blockText(out[5])).toBe(REF_ENTRY)
    expect(out[0]).toBe(before[0])

    // At least one body paragraph improved (no longer the broken original).
    const bodyChanged = blockText(out[2]) !== BODY1 || blockText(out[3]) !== BODY2
    expect(bodyChanged).toBe(true)

    console.log(`[eval] Step P changed ${decisions.length} paragraph(s) (model=${loadAiConfig().model})`)
    for (const d of decisions) console.log(`[eval]   #${d.i}: ${d.text}`)
  }, 60_000)
})
