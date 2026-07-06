import { describe, it, expect } from 'vitest'
import {
  chunkProofread,
  applyProofreadDecisions,
  stepProofread,
  type ProofreadChunk,
  type ProofreadDecider,
  type ProofreadDecision,
} from './stepProofread'
import { getBlocks, blockText } from './blocks'

const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`
const para = (inner: string, pPr = '') => `<w:p>${pPr}${inner}</w:p>`
const styled = (style: string, text: string) => para(run(text), `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`)
const BOLD = '<w:rPr><w:b/></w:rPr>'

// Indices:
//  0 Title (skip)  1 Heading1  2 body  3 list item  4 Caption (skip)
//  5 ReferencesHeading  6 ref entry (skip — at/after refStartIndex)
const DOC =
  `<w:document><w:body>` +
  styled('Title', 'O Título do Trabalho') +                                   // 0
  styled('Heading1', 'Introdução') +                                          // 1
  para(run('O aluno fizeram a prova com ') + run('cuidado', BOLD) + run('.')) + // 2
  para(run('Primeiro item'), '<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>') + // 3
  styled('Caption', 'Figura 1 — exemplo') +                                   // 4
  styled('ReferencesHeading', 'REFERÊNCIAS') +                                // 5
  para(run('Gil, A. C. Como elaborar projetos. Atlas, 2017.')) +             // 6
  `</w:body></w:document>`

const REF_START = 5

describe('chunkProofread', () => {
  it('includes headings, body and list items but skips title, caption and references', () => {
    const [chunk] = chunkProofread(DOC, 'abnt', { refStartIndex: REF_START })
    expect(chunk.blocks.map(b => b.i)).toEqual([1, 2, 3]) // 0 title, 4 caption, 5/6 refs excluded
    expect(chunk.blocks[1].text).toBe('O aluno fizeram a prova com cuidado.') // full run-concatenated text
  })

  it('excludes cover blocks via excludeIndices but still proofreads the rest of the front matter', () => {
    // 0 capa line (exclude) · 1 RESUMO heading · 2 resumo prose · 3 body heading · 4 body
    const doc = `<w:document><w:body>` +
      para(run('UNIVERSIDADE FEDERAL DE MINAS GERAIS')) +
      styled('ReferencesHeading', 'RESUMO') +
      para(run('Este trabalho investiga a formatacao.')) +
      para(run('1 INTRODUÇÃO'), `<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>`) +
      para(run('corpo do texto')) +
      `</w:body></w:document>`
    const chunks = chunkProofread(doc, 'abnt', { excludeIndices: new Set([0]) })
    const all = chunks.flatMap(c => c.blocks.map(b => b.i))
    expect(all).toEqual([1, 2, 3, 4]) // capa (0) excluded; resumo heading+prose (1,2) still proofread
  })

  it('starts a new chunk at each Heading1 (chapter) boundary', () => {
    const doc =
      `<w:document><w:body>` +
      styled('Heading1', 'Capítulo 1') +
      para(run('Corpo do capítulo um.')) +
      styled('Heading1', 'Capítulo 2') +
      para(run('Corpo do capítulo dois.')) +
      `</w:body></w:document>`
    const chunks = chunkProofread(doc, 'abnt')
    expect(chunks.length).toBe(2)
    expect(chunks[0].blocks.map(b => b.i)).toEqual([0, 1])
    expect(chunks[1].blocks.map(b => b.i)).toEqual([2, 3])
  })

  it('splits on the char budget without splitting a paragraph', () => {
    const chunks = chunkProofread(DOC, 'abnt', { refStartIndex: REF_START, maxChars: 20 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap(c => c.blocks.map(b => b.i))).toEqual([1, 2, 3])
  })

  it('splits on the paragraph-count cap even when the char budget is generous', () => {
    // Candidates [1,2,3] fit in 10000 chars; maxBlocks:2 forces 2 chunks.
    const chunks = chunkProofread(DOC, 'abnt', { refStartIndex: REF_START, maxChars: 10000, maxBlocks: 2 })
    expect(chunks.length).toBe(2) // [1,2] [3]
    expect(chunks.every(c => c.blocks.length <= 2)).toBe(true)
    expect(chunks.flatMap(c => c.blocks.map(b => b.i))).toEqual([1, 2, 3])
  })
})

describe('applyProofreadDecisions', () => {
  it('applies a correction while preserving the bold run, and never touches refs/title', () => {
    const decisions: ProofreadDecision[] = [
      { i: 2, text: 'O aluno fez a prova com cuidado.' },
    ]
    const out = applyProofreadDecisions(DOC, decisions)
    const blocks = getBlocks(out)
    expect(blocks).toHaveLength(getBlocks(DOC).length) // block count never changes
    expect(blockText(blocks[2])).toBe('O aluno fez a prova com cuidado.')
    expect(blocks[2]).toContain(`${BOLD}<w:t xml:space="preserve">cuidado</w:t>`) // bold survives
    expect(blocks[0]).toBe(getBlocks(DOC)[0]) // title untouched
    expect(blocks[6]).toBe(getBlocks(DOC)[6]) // reference entry untouched
  })

  it('ignores unknown indices and no-op corrections', () => {
    expect(applyProofreadDecisions(DOC, [{ i: 99, text: 'x' }])).toBe(DOC)
    expect(applyProofreadDecisions(DOC, [{ i: 2, text: blockText(getBlocks(DOC)[2]) }])).toBe(DOC)
  })
})

describe('stepProofread (end to end with fake decider)', () => {
  // Fake: collapse the agreement error "fizeram" -> "fez" wherever it appears.
  const fakeDecider: ProofreadDecider = {
    async proofread(chunk) {
      return chunk.blocks
        .filter(b => b.text.includes('fizeram'))
        .map(b => ({ i: b.i, text: b.text.replace('fizeram', 'fez') }))
    },
  }

  it('corrects body text, preserves block count, leaves refs and title alone', async () => {
    const before = getBlocks(DOC).length
    const { documentXml: out, decisions } = await stepProofread(DOC, 'abnt', fakeDecider, { refStartIndex: REF_START })
    expect(decisions.map(d => d.i)).toEqual([2])
    const blocks = getBlocks(out)
    expect(blocks).toHaveLength(before)
    expect(blockText(blocks[2])).toBe('O aluno fez a prova com cuidado.')
    expect(blocks[2]).toContain('<w:b/>') // intentional bold preserved
    expect(blockText(blocks[6])).toContain('Gil, A. C.') // references untouched
  })

  it('passes the guideline through to the chunk', async () => {
    const seen: ProofreadChunk[] = []
    const spy: ProofreadDecider = { async proofread(chunk) { seen.push(chunk); return [] } }
    await stepProofread(DOC, 'abnt', spy, { refStartIndex: REF_START })
    expect(seen[0].guideline).toBe('abnt')
  })

  it('returns the document unchanged when nothing matches', async () => {
    const noop: ProofreadDecider = { async proofread() { return [] } }
    expect((await stepProofread(DOC, 'abnt', noop, { refStartIndex: REF_START })).documentXml).toBe(DOC)
  })

  it('splits a failing multi-block chunk and retries the halves', async () => {
    // Force one big chunk (maxBlocks high). Decider throws on >1 block (simulates a length
    // error), succeeds on a single block — so the chunk must subdivide down to singletons.
    const calls: number[][] = []
    const splitting: ProofreadDecider = {
      async proofread(chunk) {
        calls.push(chunk.blocks.map(b => b.i))
        if (chunk.blocks.length > 1) throw new Error('No object generated: finishReason length')
        return chunk.blocks.filter(b => b.text.includes('fizeram')).map(b => ({ i: b.i, text: b.text.replace('fizeram', 'fez') }))
      },
    }
    const { documentXml: out, decisions } = await stepProofread(DOC, 'abnt', splitting, { refStartIndex: REF_START, maxChars: 100000, maxBlocks: 100 })
    // The correction still lands despite the initial chunk failing.
    expect(decisions.map(d => d.i)).toEqual([2])
    expect(blockText(getBlocks(out)[2])).toBe('O aluno fez a prova com cuidado.')
    // It retried with progressively smaller block sets (the first call had all 3 candidates).
    expect(calls[0]).toEqual([1, 2, 3])
    expect(calls.some(c => c.length === 1)).toBe(true)
  })

  it('skips a single block that keeps failing without sinking the rest', async () => {
    // Block 2 always fails even alone; blocks 1 and 3 succeed. The pass must still finish.
    const flaky: ProofreadDecider = {
      async proofread(chunk) {
        if (chunk.blocks.some(b => b.i === 2)) throw new Error('finishReason length')
        return []
      },
    }
    const { documentXml: out } = await stepProofread(DOC, 'abnt', flaky, { refStartIndex: REF_START, maxChars: 100000, maxBlocks: 100 })
    expect(out).toBe(DOC) // no decisions applied, but no throw — pass completed
  })
})
