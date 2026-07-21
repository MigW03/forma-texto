import { describe, it, expect } from 'vitest'
import { formatCaptions, findCaptionsAbove, MAX_CONTINUATION_LINES } from './captions'
import { getBlocks, blockText } from './blocks'

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

  it('keeps the caption group together across a page break via <w:keepNext/>', () => {
    // Centered image paragraph (as the image pass leaves it) — a blank gap before it too.
    const centeredImage = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>'
    const out = formatCaptions(DOC(para('Figura 1 — Mapa') + para('') + centeredImage + para('Fonte: IBGE.')))
    const blocks = getBlocks(out)
    // The correct element is w:keepNext — NOT w:keepWithNext (which renderers ignore).
    expect(out).not.toContain('keepWithNext')
    expect(blocks[0]).toContain('<w:keepNext/>') // label keeps with what's below
    expect(blocks[1]).toContain('<w:keepNext/>') // blank gap keeps the chain intact
    expect(blocks[2]).toContain('<w:keepNext/>') // image keeps with the source line
    // On the label, keepNext sits right after pStyle (schema order: pStyle → keepNext).
    expect(blocks[0]).toMatch(/<w:pStyle w:val="Caption"\/><w:keepNext\/>/)
    // On the centered image, keepNext must come BEFORE jc (or the renderer drops it).
    expect(blocks[2]).toMatch(/<w:keepNext\/>[\s\S]*<w:jc/)
    expect(blocks[2].indexOf('<w:keepNext/>')).toBeLessThan(blocks[2].indexOf('<w:jc'))
  })

  it('does not add keepNext to the source line (last of the group)', () => {
    const out = formatCaptions(DOC(para('Figura 1 — Mapa') + imagePara + para('Fonte: IBGE.') + para('Body after.')))
    const blocks = getBlocks(out)
    expect(blocks[2]).toContain('Fonte') // the source paragraph
    expect(blocks[2]).not.toContain('<w:keepNext/>') // nothing to keep it with below
  })

  it('captions a "Figura N. " line (period separator instead of dash/colon)', () => {
    const out = formatCaptions(DOC(para('Figura 12. Respostas dos alunos.') + imagePara + para('Fonte: Imagem da autora.')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption')
    expect(styleOf(blocks[2])).toBe('Caption')
  })

  it('rewrites "Figura N." to "Figura N:" on the caption label', () => {
    const out = formatCaptions(DOC(para('Figura 12. Respostas dos alunos.') + imagePara + para('Fonte: Imagem da autora.')))
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('Figura 12: Respostas dos alunos.')
  })

  it('preserves the sub-number dot ("Figura 12.1.") while still fixing the separator', () => {
    const out = formatCaptions(DOC(para('Figura 12.1. Detalhe.') + imagePara + para('Fonte: Autor.')))
    const blocks = getBlocks(out)
    expect(blockText(blocks[0])).toBe('Figura 12.1: Detalhe.')
  })

  it('splits a caption/source embedded as a SECOND run in the image\'s own paragraph', () => {
    // [drawing run]["Fonte: Imagem da autora" run] inside ONE <w:p> — seen in Google
    // Docs exports. Must become its own Caption-styled paragraph, separate from the image.
    const imageWithEmbeddedSource =
      '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r>' +
      '<w:r><w:t>Fonte. Imagem da autora</w:t></w:r></w:p>'
    const out = formatCaptions(DOC(para('Figura 22 — Trabalho') + imageWithEmbeddedSource + para('Próximo parágrafo.')))
    const blocks = getBlocks(out)
    expect(blocks).toHaveLength(4) // label, image (alone), source (split out), next paragraph
    expect(styleOf(blocks[1])).toBeNull() // image paragraph — no longer carries text
    expect(blockText(blocks[1])).toBe('')
    expect(styleOf(blocks[2])).toBe('Caption')
    expect(blockText(blocks[2])).toBe('Fonte: Imagem da autora') // dot normalized to colon too
  })

  it('splits an embedded figure label BEFORE the drawing run in the same paragraph', () => {
    const imageWithEmbeddedLabel =
      '<w:p><w:r><w:t>Figura 5. Antes do desenho</w:t></w:r>' +
      '<w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>'
    const out = formatCaptions(DOC(imageWithEmbeddedLabel + para('Fonte: Autor.')))
    const blocks = getBlocks(out)
    expect(blocks).toHaveLength(3) // label (split out), image (alone), source
    expect(styleOf(blocks[0])).toBe('Caption')
    expect(blockText(blocks[0])).toBe('Figura 5: Antes do desenho')
    expect(blockText(blocks[1])).toBe('')
  })

  it('styles and normalizes a table caption above and source below a table', () => {
    const out = formatCaptions(DOC(para('Tabela 1. Resultados') + tbl + para('Fonte. Autor (2024)')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption')
    expect(blockText(blocks[0])).toBe('Tabela 1: Resultados')
    expect(styleOf(blocks[2])).toBe('Caption')
    expect(blockText(blocks[2])).toBe('Fonte: Autor (2024)')
  })

  it('rewrites "Fonte." to "Fonte:" on the source line', () => {
    const out = formatCaptions(DOC(para('Figura 1 — Mapa') + imagePara + para('Fonte. IBGE.')))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[2])).toBe('Caption')
    expect(blockText(blocks[2])).toBe('Fonte: IBGE.')
  })

  it('leaves a correctly-punctuated "Fonte:" source line untouched', () => {
    const out = formatCaptions(DOC(para('Figura 1 — Mapa') + imagePara + para('Fonte: IBGE.')))
    const blocks = getBlocks(out)
    expect(blockText(blocks[2])).toBe('Fonte: IBGE.')
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

  it('captions a "Figura N —" line separated from the image by blank lines', () => {
    // Author left a blank paragraph between the caption and the image, and between the
    // image and the source — both must still be recognised (skipping the blanks).
    const out = formatCaptions(DOC(
      para('Figura 3 — Banksy') + para('') + imagePara + para('') + para('Fonte: CNN Brasil.'),
    ))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption')  // figure label, one blank line above the image
    expect(styleOf(blocks[1])).toBeNull()       // the blank paragraph — untouched
    expect(styleOf(blocks[2])).toBeNull()        // the image itself
    expect(styleOf(blocks[4])).toBe('Caption')  // source, one blank line below the image
  })

  it('treats consecutive non-blank paragraphs between label and image as a multi-line caption', () => {
    // Label directly above image plus a continuation line above that — both get tagged.
    const out = formatCaptions(DOC(
      para('Figura 3 — Título longo que') + para('continua nesta segunda linha') + imagePara,
    ))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption') // label line
    expect(styleOf(blocks[1])).toBe('Caption') // continuation line
  })

  it('does NOT look past another image to grab a caption from a previous figure', () => {
    // label → IMAGE_A → body → IMAGE_B: IMAGE_A is a hard barrier, body is not tagged.
    const out = formatCaptions(DOC(
      para('Figura 3 — earlier caption') + imagePara + para('body between images') + imagePara,
    ))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption') // first image's own caption — tagged
    expect(styleOf(blocks[2])).toBeNull()       // body after IMAGE_A — NOT pulled to IMAGE_B
  })

  it('tags a long multi-line caption with many continuation lines', () => {
    // Real ABNT captions can span many lines; all continuation lines up to
    // MAX_CONTINUATION_LINES should be tagged.
    const lines = [para('Figura 1 — label')]
    for (let k = 0; k < MAX_CONTINUATION_LINES; k++) lines.push(para(`continuation ${k}`))
    const out = formatCaptions(DOC(lines.join('') + imagePara))
    const blocks = getBlocks(out)
    // Label + all continuations tagged.
    for (let k = 0; k <= MAX_CONTINUATION_LINES; k++) {
      expect(styleOf(blocks[k])).toBe('Caption')
    }
  })

  it('stops scan when continuation count exceeds the limit', () => {
    const lines = [para('Figura 1 — label')]
    for (let k = 0; k < MAX_CONTINUATION_LINES + 1; k++) lines.push(para(`continuation ${k}`))
    const out = formatCaptions(DOC(lines.join('') + imagePara))
    const blocks = getBlocks(out)
    for (let k = 0; k <= MAX_CONTINUATION_LINES + 1; k++) {
      expect(styleOf(blocks[k])).toBeNull()
    }
  })

  it('crosses a single blank between the label and a continuation paragraph', () => {
    // Authors sometimes leave a blank line between "Figura N —" and a description
    // paragraph before the image. The blank peek finds the label and tags both.
    const out = formatCaptions(DOC(
      para('Figura 1 — label') + para('') + para('description paragraph') + imagePara,
    ))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBe('Caption') // label reached via blank peek
    expect(styleOf(blocks[2])).toBe('Caption') // description paragraph tagged
  })

  it('stops scan at two consecutive blanks between label and continuation', () => {
    // Two blanks in a row — too far to be the same caption group.
    const out = formatCaptions(DOC(
      para('Figura 1 — label') + para('') + para('') + para('separate paragraph') + imagePara,
    ))
    const blocks = getBlocks(out)
    expect(styleOf(blocks[0])).toBeNull() // label not reached
    expect(styleOf(blocks[3])).toBeNull() // "separate paragraph" not tagged
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
