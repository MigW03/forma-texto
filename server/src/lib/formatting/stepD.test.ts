import { describe, it, expect } from 'vitest'
import {
  chunkHeadings,
  applyHeadingDecisions,
  stepD,
  type HeadingDecider,
  type HeadingDecision,
} from './stepD'
import { getBlocks, blockText } from './blocks'

// Synthetic body. Indices:
//  0 Title (already styled)   1 "1 INTRODUÇÃO" bold   2 body   3 "1.1 Contexto" bold
//  4 body   5 empty   6 ReferencesHeading   7 reference entry
const DOC = `<w:document><w:body>` +
  `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>MEU TÍTULO</w:t></w:r></w:p>` +
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1 INTRODUÇÃO</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Primeiro parágrafo do corpo do texto.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>1.1 Contexto</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Mais um parágrafo de corpo.</w:t></w:r></w:p>` +
  `<w:p/>` +
  `<w:p><w:pPr><w:pStyle w:val="ReferencesHeading"/></w:pPr><w:r><w:t>REFERÊNCIAS</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Gil, Antônio Carlos. Como elaborar projetos.</w:t></w:r></w:p>` +
  `</w:body></w:document>`

const REF_START = 6

/** Deterministic fake: numeric-prefix rule. Echoes every i it was given. */
const fakeDecider: HeadingDecider = {
  async classify(chunk) {
    return chunk.blocks.map(b => {
      const t = b.text.trim()
      if (/^\d+\.\d+\s/.test(t)) return { i: b.i, role: 'h2' as const }
      if (/^\d+\s/.test(t)) return { i: b.i, role: 'h1' as const }
      return { i: b.i, role: 'body' as const }
    })
  },
}

describe('chunkHeadings', () => {
  it('keeps only non-empty body paragraphs before the references section', () => {
    const [chunk] = chunkHeadings(DOC, 'abnt', { refStartIndex: REF_START })
    expect(chunk.blocks.map(b => b.i)).toEqual([0, 1, 2, 3, 4]) // 5 empty, 6/7 refs excluded
  })

  it('splits when the char budget is exceeded, never mid-block', () => {
    const chunks = chunkHeadings(DOC, 'abnt', { refStartIndex: REF_START, maxChars: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    const indices = chunks.flatMap(c => c.blocks.map(b => b.i))
    expect(indices).toEqual([0, 1, 2, 3, 4]) // every candidate present, in order
    expect(chunks.every(c => c.totalChunks === chunks.length)).toBe(true)
  })

  it('carries prior heading text as cross-chunk context', () => {
    const chunks = chunkHeadings(DOC, 'abnt', { refStartIndex: REF_START, maxChars: 60 })
    const later = chunks.find(c => c.chunkIndex > 0)
    expect(later?.context.length).toBeGreaterThan(0)
  })

  it('returns no chunks when there are no candidates', () => {
    expect(chunkHeadings('<w:document><w:body><w:p/></w:body></w:document>', 'abnt')).toEqual([])
  })
})

describe('applyHeadingDecisions', () => {
  it('promotes only title/h1/h2/h3 and leaves body + unlisted blocks untouched', () => {
    const decisions: HeadingDecision[] = [
      { i: 1, role: 'h1' },
      { i: 2, role: 'body' },
      { i: 3, role: 'h2' },
    ]
    const out = applyHeadingDecisions(DOC, decisions)
    const blocks = getBlocks(out)
    expect(blocks[1]).toContain('<w:pStyle w:val="Heading1"/>')
    expect(blocks[3]).toContain('<w:pStyle w:val="Heading2"/>')
    expect(blocks[2]).not.toContain('w:pStyle') // body = no-op
    expect(blocks[0]).toContain('<w:pStyle w:val="Title"/>') // unlisted, untouched
  })

  it('never alters text content', () => {
    const out = applyHeadingDecisions(DOC, [{ i: 1, role: 'h1' }])
    expect(blockText(getBlocks(out)[1])).toBe('1 INTRODUÇÃO')
  })
})

describe('stepD (end to end with fake decider)', () => {
  it('classifies and applies heading styles by index', async () => {
    const { documentXml: out, decisions } = await stepD(DOC, 'abnt', fakeDecider, { refStartIndex: REF_START })
    expect(decisions.filter(d => d.role !== 'body').map(d => d.i)).toEqual([1, 3])
    const blocks = getBlocks(out)
    expect(blocks[1]).toContain('<w:pStyle w:val="Heading1"/>') // "1 INTRODUÇÃO"
    expect(blocks[3]).toContain('<w:pStyle w:val="Heading2"/>') // "1.1 Contexto"
    expect(blocks[2]).not.toContain('w:pStyle') // body paragraph untouched
    expect(blocks[6]).toContain('w:val="ReferencesHeading"') // refs region untouched
  })

  it('returns the document unchanged when there is nothing to classify', async () => {
    const empty = '<w:document><w:body><w:p/></w:body></w:document>'
    expect((await stepD(empty, 'abnt', fakeDecider)).documentXml).toBe(empty)
  })
})
