import { describe, it, expect } from 'vitest'
import { formatLongQuotes } from './longQuotes'
import { getBlocks, blockText } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

// A passage comfortably over three lines (>280 chars).
const LONG =
  'A investigação sobre o ensino da arte contemporânea revela que a mediação escolar precisa ' +
  'reconhecer as poéticas do presente, articulando repertórios visuais diversos e propondo ' +
  'experiências estéticas que ampliem a leitura crítica dos estudantes diante das imagens que ' +
  'circulam no cotidiano da cultura.'

/** A paragraph with optional pPr children (indent/style) and a single text run. */
const para = (text: string, opts: { left?: number; style?: string; numbered?: boolean } = {}) => {
  const bits: string[] = []
  if (opts.style) bits.push(`<w:pStyle w:val="${opts.style}"/>`)
  if (opts.numbered) bits.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
  if (opts.left != null) bits.push(`<w:ind w:left="${opts.left}" w:firstLine="0"/>`)
  const pPr = bits.length ? `<w:pPr>${bits.join('')}</w:pPr>` : ''
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

const styleOf = (b: string) => b.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? null

describe('formatLongQuotes', () => {
  it('tags an author-indented long paragraph as a LongQuote', () => {
    const out = formatLongQuotes(DOC(para(LONG, { left: 2268 })))
    expect(styleOf(getBlocks(out)[0])).toBe('LongQuote')
  })

  it('leaves a short indented paragraph alone (stays inline)', () => {
    const short = 'Uma frase curta indentada.'
    const doc = DOC(para(short, { left: 2268 }))
    expect(formatLongQuotes(doc)).toBe(doc)
  })

  it('leaves a long, flush-left, unquoted body paragraph alone', () => {
    const doc = DOC(para(LONG)) // no indent, no quotes
    expect(formatLongQuotes(doc)).toBe(doc)
  })

  it('converts an over-long wholly-quoted paragraph and strips the quotation marks', () => {
    const out = formatLongQuotes(DOC(para(`“${LONG}”`)))
    const b = getBlocks(out)[0]
    expect(styleOf(b)).toBe('LongQuote')
    const t = blockText(b)
    expect(t.startsWith('“')).toBe(false)
    expect(t.endsWith('”')).toBe(false)
    expect(t).toContain('investigação sobre o ensino')
  })

  it('keeps a trailing author-date citation while stripping the close quote', () => {
    const out = formatLongQuotes(DOC(para(`“${LONG}” (SILVA, 2020, p. 42).`)))
    const t = blockText(getBlocks(out)[0])
    expect(styleOf(getBlocks(out)[0])).toBe('LongQuote')
    expect(t).toContain('(SILVA, 2020, p. 42).')
    expect(t).not.toContain('”') // the closing quote before the citation is gone
    expect(t.startsWith('“')).toBe(false)
  })

  it('handles straight and guillemet quotation marks', () => {
    const straight = formatLongQuotes(DOC(para(`"${LONG}"`)))
    expect(blockText(getBlocks(straight)[0]).includes('"')).toBe(false)
    const guill = formatLongQuotes(DOC(para(`«${LONG}»`)))
    const gt = blockText(getBlocks(guill)[0])
    expect(gt.includes('«') || gt.includes('»')).toBe(false)
  })

  it('does not convert a heading-styled long paragraph', () => {
    const doc = DOC(para(LONG, { left: 2268, style: 'Heading1' }))
    expect(formatLongQuotes(doc)).toBe(doc)
  })

  it('does not convert a long list item', () => {
    const doc = DOC(para(LONG, { left: 2268, numbered: true }))
    expect(formatLongQuotes(doc)).toBe(doc)
  })

  it('freezes blocks at/after stopAt (appendix/annex)', () => {
    const doc = DOC(para(LONG, { left: 2268 }) + para(`“${LONG}”`))
    const out = formatLongQuotes(doc, 1) // only block 0 is eligible
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('LongQuote')
    expect(styleOf(blocks[1])).toBeNull() // frozen
  })

  it('only strips quotes inside <w:t>, never attribute quotes in tags', () => {
    const out = formatLongQuotes(DOC(para(`“${LONG}”`)))
    // the run/paragraph tags and their attribute quotes stay intact
    expect(out).toContain('<w:t xml:space="preserve">')
    expect(out).toContain('<w:document xmlns:w=')
  })

  it('returns the document unchanged when nothing qualifies', () => {
    const doc = DOC(para('Parágrafo comum, curto e sem recuo.'))
    expect(formatLongQuotes(doc)).toBe(doc)
  })

  describe('embedded quotation (lead-in / quote / trailing prose in one paragraph)', () => {
    it('splits into lead-in, LongQuote, and trailing paragraphs', () => {
      const doc = DOC(para(`Como afirma o autor: “${LONG}” Assim, conclui-se o argumento.`))
      const blocks = getBlocks(formatLongQuotes(doc))
      expect(blocks).toHaveLength(3)
      expect(blockText(blocks[0])).toBe('Como afirma o autor:')
      expect(styleOf(blocks[1])).toBe('LongQuote')
      const quoteText = blockText(blocks[1])
      expect(quoteText.startsWith('“')).toBe(false)
      expect(quoteText.endsWith('”')).toBe(false)
      expect(quoteText).toContain('investigação sobre o ensino')
      expect(blockText(blocks[2])).toBe('Assim, conclui-se o argumento.')
    })

    it('omits the trailing paragraph when the quote runs to the end', () => {
      const doc = DOC(para(`Como afirma o autor: “${LONG}”`))
      const blocks = getBlocks(formatLongQuotes(doc))
      expect(blocks).toHaveLength(2)
      expect(blockText(blocks[0])).toBe('Como afirma o autor:')
      expect(styleOf(blocks[1])).toBe('LongQuote')
    })

    it('leaves it alone when the embedded quoted span itself is short, even if the whole paragraph is long', () => {
      const doc = DOC(para(`${LONG} Diz o autor: "curta." ${LONG}`))
      expect(formatLongQuotes(doc)).toBe(doc)
    })

    it('preserves run-level formatting (bold/italic) across the split', () => {
      const leadRuns =
        '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Como </w:t></w:r>' +
        '<w:r><w:t xml:space="preserve">afirma o autor: </w:t></w:r>'
      const quoteRuns =
        '<w:r><w:t xml:space="preserve">“</w:t></w:r>' +
        `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${LONG}</w:t></w:r>` +
        '<w:r><w:t xml:space="preserve">”</w:t></w:r>'
      const trailRuns = '<w:r><w:t xml:space="preserve"> Assim conclui-se.</w:t></w:r>'
      const doc = DOC(`<w:p>${leadRuns}${quoteRuns}${trailRuns}</w:p>`)
      const blocks = getBlocks(formatLongQuotes(doc))
      expect(blocks).toHaveLength(3)
      expect(blocks[0]).toContain('<w:b/>')
      expect(blocks[1]).toContain('<w:i/>')
      expect(styleOf(blocks[1])).toBe('LongQuote')
      expect(blockText(blocks[2])).toBe('Assim conclui-se.')
    })

    it('leaves a paragraph with a hyperlink unchanged even though it looks like an embedded long quote', () => {
      const p =
        `<w:p><w:r><w:t xml:space="preserve">Como afirma o autor: “${LONG}” </w:t></w:r>` +
        '<w:hyperlink r:id="rId1"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>'
      const doc = DOC(p)
      expect(formatLongQuotes(doc)).toBe(doc)
    })

    it('does not attempt an embedded split at/after stopAt', () => {
      const doc = DOC(para(`Como afirma o autor: “${LONG}” Assim conclui.`))
      expect(formatLongQuotes(doc, 0)).toBe(doc) // block 0 frozen
    })
  })
})
