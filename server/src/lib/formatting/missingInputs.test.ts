import { describe, it, expect } from 'vitest'
import { detectAndInsertPlaceholders, finalizeInputs } from './missingInputs'
import { getBlocks, blockText } from './blocks'

const DOC = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:body>${body}</w:body></w:document>`

const para = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const captionPara = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Caption"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
const imagePara = '<w:p><w:r><w:drawing><wp:inline><a:blip r:embed="rId7"/></wp:inline></w:drawing></w:r></w:p>'
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
    expect(blockText(captionBlock)).toBe('Figura 1 — minha legenda')
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
    expect(blockText(blocks[0])).toBe('Figura 1 — legenda ok')
    expect(isRed(blocks[0])).toBe(false)
  })

  it('escapes XML special characters in fill text', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    const result = finalizeInputs(
      docWithPlaceholders,
      [{ id: pending[0].id, text: 'a & b < c > d' }],
      [],
      pending,
    )
    const blocks = getBlocks(result)
    expect(blocks[pending[0].insertedAt]).toContain('a &amp; b &lt; c &gt; d')
  })

  it('returns document unchanged when fills and removals are both empty', () => {
    const doc = DOC(imagePara)
    const { xml: docWithPlaceholders, pending } = detectAndInsertPlaceholders(doc)
    expect(finalizeInputs(docWithPlaceholders, [], [], pending)).toBe(docWithPlaceholders)
  })
})
