import { describe, it, expect } from 'vitest'
import { detectAndInsertPlaceholders, finalizeInputs, normalizeInputText } from './missingInputs'
import { getBlocks, blockText } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const captionPara = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const imagePara = '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>'
// Some exported docs (e.g. Google Docs) put the figure's caption/source text as a
// second run in the SAME paragraph as the drawing, instead of its own paragraph.
const imageParaWithText = (text: string) =>
  `<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r><w:r><w:t>${text}</w:t></w:r></w:p>`
const tablePara = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'

const styleOf = (b: string) => b.match(/<w:pStyle\b[^>]*w:val="([^"]*)"/)?.[1] ?? null
const isRed = (b: string) => b.includes('w:val="FF0000"')
const isPlaceholder = (b: string) => styleOf(b) === 'Caption' && isRed(b)

describe('detectAndInsertPlaceholders', () => {
  it('returns document unchanged when no images or tables', () => {
    const doc = DOC(para('text'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    expect(xml).toBe(doc)
    expect(pending).toHaveLength(0)
  })

  it('does NOT insert a caption placeholder when a "Figura N" line is a blank line away', () => {
    // The bug from a real doc: the author's "Figura 3 — …" caption sits one blank line
    // above the image, so the old adjacency-only check inserted a spurious placeholder.
    const doc = DOC(para('Figura 3 — Banksy') + para('') + imagePara + para('') + para('Fonte: CNN.'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    expect(xml).toBe(doc)            // nothing inserted
    expect(pending).toHaveLength(0)  // caption AND source both recognised across the blanks
  })

  it('inserts caption and source placeholders around an image', () => {
    const doc = DOC(para('intro') + imagePara + para('body'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    // intro, [caption placeholder], image, [source placeholder], body
    expect(blocks).toHaveLength(5)
    expect(isPlaceholder(blocks[1])).toBe(true)
    expect(isPlaceholder(blocks[3])).toBe(true)
    expect(pending).toHaveLength(2)
    expect(pending[0].kind).toBe('figure_caption')
    expect(pending[0].ordinal).toBe(1)
    expect(pending[0].insertedAt).toBe(1)
    expect(pending[1].kind).toBe('figure_source')
    expect(pending[1].ordinal).toBe(1)
    expect(pending[1].insertedAt).toBe(3)
  })

  it('inserts caption and source placeholders around a table', () => {
    const doc = DOC(para('intro') + tablePara + para('body'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(5)
    expect(isPlaceholder(blocks[1])).toBe(true) // table_caption
    expect(isPlaceholder(blocks[3])).toBe(true) // table_source
    expect(pending[0].kind).toBe('table_caption')
    expect(pending[1].kind).toBe('table_source')
  })

  it('does not insert caption placeholder when figure label already present', () => {
    const doc = DOC(para('Figura 1 — já existe') + imagePara + para('body'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    // existing label, image, [source placeholder], body
    expect(blocks).toHaveLength(4)
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('figure_source')
  })

  it('does not insert caption placeholder when Caption-styled paragraph is above image', () => {
    const doc = DOC(captionPara('Figura 1 — legenda') + imagePara + para('body'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(4) // caption, image, [source placeholder], body
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('figure_source')
  })

  it('does not insert source placeholder when Fonte line already present', () => {
    const doc = DOC(para('intro') + imagePara + para('Fonte: autor (2024).'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(4) // intro, [caption placeholder], image, fonte
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('figure_caption')
  })

  it('does not insert placeholders when caption/source use a period separator ("Figura 12. ...")', () => {
    const doc = DOC(para('Figura 12. Respostas dos alunos.') + imagePara + para('Fonte: Imagem da autora.'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(3) // label, image, fonte — nothing inserted
    expect(pending).toHaveLength(0)
  })

  it('does not insert a source placeholder when the next image already starts its own "Figura N" label', () => {
    // A run of uncaptioned images followed directly by a labelled figure — the
    // unlabelled image's "missing source" check must not wedge a placeholder right
    // before the next figure's own caption.
    const doc = DOC(imagePara + imagePara + imagePara + para('Figura 22 — Já tem legenda') + imagePara + para('Fonte: Imagem da autora.'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    // [caption placeholder for fig 1], img, img, img, label, img, fonte — no other placeholder
    expect(blocks).toHaveLength(7)
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('figure_caption')
  })

  it('does not insert a source placeholder when "Fonte:" is a run in the SAME paragraph as the drawing', () => {
    const doc = DOC(para('Figura 22: Trabalho de um dos grupos') + imageParaWithText('Fonte: Imagem da autora') + para('3 CONSIDERAÇÕES FINAIS'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(3) // label, image+fonte (one paragraph), heading — nothing inserted
    expect(pending).toHaveLength(0)
  })

  it('does not insert a caption placeholder when "Figura N" is a run in the SAME paragraph as the drawing', () => {
    const doc = DOC(imageParaWithText('Figura 1 — legenda') + para('Fonte: autor (2024).'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(2)
    expect(pending).toHaveLength(0)
  })

  it('replaces an empty "Fonte: " line with a placeholder for a figure (block count unchanged)', () => {
    // The original file has "Fonte: " with nothing after the colon.
    // Instead of inserting a new block, the empty line itself becomes the placeholder.
    const doc = DOC(para('Figura 1 — mapa') + imagePara + para('Fonte: ') + para('body'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    // label, image, [placeholder replacing empty fonte], body — same count as input
    expect(blocks).toHaveLength(4)
    expect(isPlaceholder(blocks[2])).toBe(true)
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('figure_source')
    expect(pending[0].insertedAt).toBe(2)
  })

  it('replaces a bare "Fonte:" line (no trailing content) with a placeholder for a table', () => {
    const doc = DOC(para('Tabela 1 — dados') + tablePara + para('Fonte:') + para('body'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    expect(blocks).toHaveLength(4)
    expect(isPlaceholder(blocks[2])).toBe(true)
    expect(pending).toHaveLength(1)
    expect(pending[0].kind).toBe('table_source')
  })

  it('does NOT replace a fonte line that has actual content', () => {
    const doc = DOC(para('Figura 1 — mapa') + imagePara + para('Fonte: Autor (2024).'))
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    expect(xml).toBe(doc)
    expect(pending).toHaveLength(0)
  })

  it('skips placeholders between stacked images', () => {
    const doc = DOC(imagePara + imagePara)
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    // [caption for fig 1], img, img, [source for fig 2]
    expect(blocks).toHaveLength(4)
    expect(pending).toHaveLength(2)
    expect(pending[0].kind).toBe('figure_caption')
    expect(pending[0].insertedAt).toBe(0)
    expect(pending[1].kind).toBe('figure_source')
    expect(pending[1].insertedAt).toBe(3)
  })

  it('tracks correct insertedAt for multiple images', () => {
    const doc = DOC(imagePara + para('mid') + imagePara)
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    const blocks = getBlocks(xml)
    // [cap1], img1, [src1], mid, [cap2], img2, [src2]
    expect(blocks).toHaveLength(7)
    expect(pending).toHaveLength(4)
    expect(pending[0].insertedAt).toBe(0)
    expect(pending[1].insertedAt).toBe(2)
    expect(pending[2].insertedAt).toBe(4)
    expect(pending[3].insertedAt).toBe(6)
  })

  it('assigns sequential ordinals per kind across mixed images and tables', () => {
    const doc = DOC(imagePara + para('mid') + tablePara)
    const { pending } = detectAndInsertPlaceholders(doc)
    const figItems = pending.filter(p => p.kind.startsWith('figure'))
    const tblItems = pending.filter(p => p.kind.startsWith('table'))
    expect(figItems[0].ordinal).toBe(1)
    expect(tblItems[0].ordinal).toBe(1)
  })

  it('returns unique ids for each pending input', () => {
    const doc = DOC(imagePara + para('mid') + imagePara)
    const { pending } = detectAndInsertPlaceholders(doc)
    const ids = new Set(pending.map(p => p.id))
    expect(ids.size).toBe(pending.length)
  })

  it('returns unchanged document when all captions and sources already exist', () => {
    const doc = DOC(
      para('Figura 1 — legenda') +
      imagePara +
      para('Fonte: autor.') +
      para('Tabela 1 — outra') +
      tablePara +
      para('Fonte: IBGE.')
    )
    const { xml, pending } = detectAndInsertPlaceholders(doc)
    expect(xml).toBe(doc)
    expect(pending).toHaveLength(0)
  })
})

describe('finalizeInputs', () => {
  it('replaces a placeholder with a proper Caption paragraph (no red)', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    const filled = finalizeInputs(
      docWithPlaceholders,
      [{ id: pending[0].id, text: 'Figura 1 — minha legenda' }],
      [],
      pending,
    )
    const blocks = getBlocks(filled)
    const captionBlock = blocks[pending[0].insertedAt]
    expect(styleOf(captionBlock)).toBe('Caption')
    expect(isRed(captionBlock)).toBe(false)
    // description first letter capitalised; label/number/em-dash canonical
    expect(blockText(captionBlock)).toBe('Figura 1 — Minha legenda')
  })

  it('removes a placeholder when its id is in removals', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    const filled = finalizeInputs(docWithPlaceholders, [], [pending[0].id], pending)
    const blocks = getBlocks(filled)
    // caption placeholder deleted → image is now the first block
    expect(blocks[0]).toBe(imagePara)
  })

  it('handles a mix of fills and removals in one call', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    // fill caption, remove source
    const result = finalizeInputs(
      docWithPlaceholders,
      [{ id: pending[0].id, text: 'Figura 1 — legenda ok' }],
      [pending[1].id],
      pending,
    )
    const blocks = getBlocks(result)
    // [captionBlock, imagePara] — source removed
    expect(blocks).toHaveLength(2)
    expect(blockText(blocks[0])).toBe('Figura 1 — Legenda ok')
    expect(isRed(blocks[0])).toBe(false)
  })

  it('escapes XML special characters in fill text', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    const result = finalizeInputs(
      docWithPlaceholders,
      [{ id: pending[0].id, text: 'Figura 1 — a & b < c > d' }],
      [],
      pending,
    )
    const blocks = getBlocks(result)
    expect(blocks[pending[0].insertedAt]).toContain('A &amp; b &lt; c &gt; d')
  })

  it('gives a filled source line 1.5 line spacing but leaves the caption single', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    const caption = pending.find(p => p.kind === 'figure_caption')!
    const source = pending.find(p => p.kind === 'figure_source')!
    const filled = finalizeInputs(
      docWithPlaceholders,
      [
        { id: caption.id, text: 'mapa' },
        { id: source.id, text: 'o autor' },
      ],
      [],
      pending,
    )
    const blocks = getBlocks(filled)
    expect(blocks[source.insertedAt]).toContain('<w:spacing w:line="360" w:lineRule="auto"/>')
    expect(blocks[caption.insertedAt]).not.toContain('w:line="360"')
  })

  it('returns document unchanged when fills and removals are both empty', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    expect(finalizeInputs(docWithPlaceholders, [], [], pending)).toBe(docWithPlaceholders)
  })
})

describe('normalizeInputText', () => {
  it('fixes the label casing (figura → Figura) and uses an em dash', () => {
    expect(normalizeInputText('figura 1 - mapa do brasil', 'figure_caption', 1))
      .toBe('Figura 1 — Mapa do brasil')
  })

  it('forces the number to the true ordinal even if the user retyped the wrong one', () => {
    // user typed "3" but this is the 4th figure → "Figura 4"
    expect(normalizeInputText('Figura 3 — gráfico de barras', 'figure_caption', 4))
      .toBe('Figura 4 — Gráfico de barras')
  })

  it('adds the label + ordinal when the user typed only a description', () => {
    expect(normalizeInputText('mapa da região', 'figure_caption', 2))
      .toBe('Figura 2 — Mapa da região')
  })

  it('normalizes a table caption (any typed label) to Tabela N', () => {
    expect(normalizeInputText('quadro 2 - resultados', 'table_caption', 5))
      .toBe('Tabela 5 — Resultados')
  })

  it('canonicalizes a source line to "Fonte: …" with a capital first letter', () => {
    expect(normalizeInputText('fonte: elaborado pelo autor', 'figure_source', 1))
      .toBe('Fonte: Elaborado pelo autor')
    expect(normalizeInputText('o autor (2024)', 'table_source', 1))
      .toBe('Fonte: O autor (2024)')
  })

  it('applies the deterministic text rules to the description', () => {
    // double space + space-before-punct + straight quotes
    expect(normalizeInputText('figura 1 - o  "mapa" temático .', 'figure_caption', 1))
      .toBe('Figura 1 — O “mapa” temático.')
  })
})
