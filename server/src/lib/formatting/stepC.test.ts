import { describe, it, expect } from 'vitest'
import {
  chunkReferences,
  applyReferenceDecisions,
  renderSegments,
  setParagraphRuns,
  stepC,
  type ReferenceChunk,
  type ReferenceDecider,
  type ReferenceDecision,
} from './stepC'
import { getBlocks, blockText } from './blocks'
import { locateReferences } from './references'

// Synthetic body. The leading page break in block 2 puts the references on page 2,
// so the user can flag page 2 as references (mirroring the real flow). Indices:
//  page 1: 0 body   1 empty
//  page 2: 2 ReferencesHeading   3 entry (Step-B formatted)   4 entry
const ENTRY3 = 'Gil, Antonio Carlos. Como elaborar projetos de pesquisa. 6. ed. Sao Paulo: Atlas, 2017.'
const ENTRY4 = 'Santos, Maria. Metodos de pesquisa. Sao Paulo: Cortez, 2019.'
const DOC = `<w:document><w:body>` +
  `<w:p><w:r><w:t>Primeiro paragrafo do corpo.</w:t></w:r></w:p>` +
  `<w:p/>` +
  `<w:p><w:pPr><w:pStyle w:val="ReferencesHeading"/></w:pPr><w:r><w:br w:type="page"/></w:r><w:r><w:t>REFERENCIAS</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>${ENTRY3}</w:t></w:r></w:p>` +
  `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>${ENTRY4}</w:t></w:r></w:p>` +
  `</w:body></w:document>`

// Page 2 is flagged as references → heading (block 2) + entries (3, 4) are the region.
const REGION = locateReferences(DOC, { selectedPages: [1, 2], referencePages: [2] })

/** Deterministic fake: bold the second "field" (the title) of each entry by splitting on the first ". ". */
const fakeDecider: ReferenceDecider = {
  async reformat(chunk) {
    return chunk.entries.map(e => {
      const first = e.text.indexOf('. ')
      if (first < 0) return { i: e.i, segments: [{ text: e.text }] }
      const author = e.text.slice(0, first + 2) // include ". "
      const rest = e.text.slice(first + 2)
      const second = rest.indexOf('. ')
      const title = second < 0 ? rest : rest.slice(0, second)
      const tail = second < 0 ? '' : rest.slice(second)
      return {
        i: e.i,
        segments: [
          { text: author },
          { text: title, emphasis: 'bold' as const },
          { text: tail },
        ],
      }
    })
  },
}

describe('renderSegments', () => {
  it('wraps emphasis in run properties and preserves spaces', () => {
    const xml = renderSegments([{ text: 'A. ' }, { text: 'Title', emphasis: 'bold' }, { text: '. rest' }])
    expect(xml).toContain('<w:r><w:t xml:space="preserve">A. </w:t></w:r>')
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Title</w:t></w:r>')
  })

  it('drops empty-text segments and escapes XML', () => {
    const xml = renderSegments([{ text: '' }, { text: 'a & b < c' }])
    expect(xml).toBe('<w:r><w:t xml:space="preserve">a &amp; b &lt; c</w:t></w:r>')
  })

  it('renders italic emphasis', () => {
    expect(renderSegments([{ text: 'et al.', emphasis: 'italic' }])).toContain('<w:rPr><w:i/></w:rPr>')
  })
})

describe('setParagraphRuns', () => {
  it('keeps the pPr and opening tag, swapping only the runs', () => {
    const p = '<w:p w:rsidR="00AB"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>old</w:t></w:r></w:p>'
    const out = setParagraphRuns(p, '<w:r><w:t>new</w:t></w:r>')
    expect(out).toBe('<w:p w:rsidR="00AB"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>new</w:t></w:r></w:p>')
  })

  it('returns the paragraph untouched for empty runs or a self-closed paragraph', () => {
    expect(setParagraphRuns('<w:p><w:r><w:t>x</w:t></w:r></w:p>', '')).toContain('x')
    expect(setParagraphRuns('<w:p/>', '<w:r><w:t>n</w:t></w:r>')).toBe('<w:p/>')
  })
})

describe('chunkReferences', () => {
  it('emits only the non-empty entry paragraphs of the references region', () => {
    const [chunk] = chunkReferences(DOC, 'abnt', REGION)
    expect(chunk.entries.map(e => e.i)).toEqual([3, 4]) // heading (2) excluded, body (0) excluded
    expect(chunk.entries[0].text).toBe(ENTRY3) // full text, not truncated
  })

  it('splits when the char budget is exceeded, never mid-entry', () => {
    const chunks = chunkReferences(DOC, 'abnt', REGION, { maxChars: 80 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.flatMap(c => c.entries.map(e => e.i))).toEqual([3, 4])
    expect(chunks.every(c => c.totalChunks === chunks.length)).toBe(true)
  })

  it('returns no chunks when there is no references region', () => {
    expect(chunkReferences(DOC, 'abnt', null)).toEqual([])
  })
})

describe('applyReferenceDecisions', () => {
  it('rewrites runs by index while leaving pPr, heading and body untouched', () => {
    const decisions: ReferenceDecision[] = [
      { i: 3, segments: [{ text: 'Gil. ' }, { text: 'Titulo', emphasis: 'bold' }, { text: '.' }] },
    ]
    const out = applyReferenceDecisions(DOC, decisions)
    const blocks = getBlocks(out)
    expect(blocks[3]).toContain('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Titulo</w:t>')
    expect(blocks[3]).toContain('<w:jc w:val="left"/>') // Step B layout preserved
    expect(blockText(blocks[3])).toBe('Gil. Titulo.')
    expect(blocks[2]).toContain('ReferencesHeading') // heading untouched
    expect(blockText(blocks[4])).toBe(ENTRY4) // other entry untouched
  })

  it('leaves an entry untouched when its decision has no usable segments', () => {
    const out = applyReferenceDecisions(DOC, [{ i: 3, segments: [{ text: '' }] }])
    expect(blockText(getBlocks(out)[3])).toBe(ENTRY3)
  })

  it('ignores unknown indices', () => {
    const out = applyReferenceDecisions(DOC, [{ i: 99, segments: [{ text: 'x' }] }])
    expect(out).toBe(DOC)
  })
})

describe('stepC (end to end with fake decider)', () => {
  it('reformats every entry and preserves block count', async () => {
    const before = getBlocks(DOC).length
    const { documentXml: out, decisions } = await stepC(DOC, 'abnt', fakeDecider, REGION)
    expect(decisions.map(d => d.i)).toEqual([3, 4])
    const blocks = getBlocks(out)
    expect(blocks).toHaveLength(before) // never adds/drops blocks
    // Title span bolded; full text preserved.
    expect(blocks[3]).toContain('<w:b/>')
    expect(blockText(blocks[3])).toBe(ENTRY3)
    expect(blockText(blocks[4])).toBe(ENTRY4)
  })

  it('returns the document unchanged when there is no references region', async () => {
    expect((await stepC(DOC, 'abnt', fakeDecider, null)).documentXml).toBe(DOC)
  })

  it('passes the guideline through to the chunk', async () => {
    const seen: ReferenceChunk[] = []
    const spy: ReferenceDecider = {
      async reformat(chunk) { seen.push(chunk); return [] }
    }
    await stepC(DOC, 'abnt', spy, REGION)
    expect(seen[0].guideline).toBe('abnt')
  })
})
