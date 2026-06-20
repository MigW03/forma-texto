import { describe, it, expect } from 'vitest'
import { formatCaptions } from './captions'
import { getBlocks } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
// An image-bearing paragraph (centered drawing, no caption text of its own).
const imagePara = '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>'
const tbl = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'

const styleOf = (block: string) => block.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? null

describe('formatCaptions', () => {
  it('captions a "Figura N —" line before and a "Fonte:" line after the image', () => {
    const out = formatCaptions(DOC(para('Body text.') + para('Figura 1 — Mapa') + imagePara + para('Fonte: IBGE.') + para('More body.')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBeNull() // ordinary body before the label — untouched
    expect(styleOf(blocks[1])).toBe('Caption') // figure label above the image
    expect(styleOf(blocks[2])).toBeNull() // the image paragraph itself — untouched
    expect(styleOf(blocks[3])).toBe('Caption') // source line below the image
    expect(styleOf(blocks[4])).toBeNull() // ordinary body after the source — untouched
  })

  it('does NOT caption unlabelled paragraphs around an image', () => {
    const out = formatCaptions(DOC(para('A flowing sentence above the figure.') + imagePara + para('A flowing sentence below the figure.')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBeNull()
    expect(styleOf(blocks[2])).toBeNull()
  })

  it('captions the source line even when there is no figure label before', () => {
    const out = formatCaptions(DOC(para('Body, not a label.') + imagePara + para('Fonte: autor (2024).')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBeNull() // no "Figura" label → not a caption
    expect(styleOf(blocks[2])).toBe('Caption') // "Fonte:" → caption
  })

  it('does not require the before line to match the source rule (and vice versa)', () => {
    // "Fonte:" sitting BEFORE an image is not a figure label → not captioned.
    const out = formatCaptions(DOC(para('Fonte: should not match before.') + imagePara + para('Figura 9 — should not match after.')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBeNull()
    expect(styleOf(blocks[2])).toBeNull()
  })

  it('accepts assorted figure labels and separators, case-insensitively', () => {
    for (const label of ['figura 1 — t', 'Imagem 2 - t', 'GRÁFICO 3: t', 'Quadro 4 – t', 'Fluxograma 1.2 — t']) {
      const out = formatCaptions(DOC(para(label) + imagePara))
      expect(styleOf(getBlocks(out)[0])).toBe('Caption')
    }
  })

  it('leaves a document with no images byte-for-byte unchanged', () => {
    const doc = DOC(para('Figura 1 — no image follows') + para('Fonte: nobody'))
    expect(formatCaptions(doc)).toBe(doc)
  })

  it('does not caption a table adjacent to an image', () => {
    const out = formatCaptions(DOC(tbl + imagePara + para('Fonte: autor.')))
    const blocks = getBlocks(out)
    expect(blocks[0]).toContain('<w:tbl>') // table left untouched (not a paragraph, no label)
    expect(styleOf(blocks[2])).toBe('Caption') // the source paragraph still captioned
  })

  it('handles two stacked images: outer label + outer source only', () => {
    const out = formatCaptions(DOC(para('Figura 1 — foto') + imagePara + imagePara + para('Fonte: x.')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption') // label above the first image
    expect(styleOf(blocks[1])).toBeNull() // first image — never a caption for the second
    expect(styleOf(blocks[2])).toBeNull() // second image
    expect(styleOf(blocks[3])).toBe('Caption') // source below the second image
  })
})
