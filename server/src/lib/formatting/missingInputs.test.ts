import { describe, it, expect } from 'vitest'
import { detectAndInsertPlaceholders, fillContent, removeContent } from './missingInputs'
import { getBlocks, blockText } from './blocks'
import { CAPTION_STYLE } from './guidelines'

// ── helpers ──────────────────────────────────────────────────────────────────

const wrap = (inner: string) =>
  `<w:document><w:body>${inner}</w:body></w:document>`

const para = (text: string, style?: string) => {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${pPr}<w:r><w:t>${text}</w:t></w:r></w:p>`
}

const captionPara = (text: string) => para(text, CAPTION_STYLE)

// Minimal <w:drawing> so isImageParagraph recognises it
const imagePara = () => `<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>`

const tableBlock = () => `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`

const hasCaptionStyle = (xml: string) => xml.includes(`w:val="${CAPTION_STYLE}"`)
const isRed = (xml: string) => xml.includes('w:val="FF0000"')

// ── detectAndInsertPlaceholders ───────────────────────────────────────────────

describe('detectAndInsertPlaceholders', () => {
  it('returns empty pending when no images or tables', () => {
    const xml = wrap(para('just text') + para('more text'))
    const { pending } = detectAndInsertPlaceholders(xml)
    expect(pending).toHaveLength(0)
  })

  it('inserts both caption and source placeholders for image with plain neighbours', () => {
    const xml = wrap(para('plain before') + imagePara() + para('plain after'))
    const { xml: out, pending } = detectAndInsertPlaceholders(xml)
    expect(pending).toHaveLength(2)
    expect(pending.find(p => p.kind === 'figure-caption')).toBeDefined()
    expect(pending.find(p => p.kind === 'figure-source')).toBeDefined()
    // Placeholder paragraphs must be red
    const blocks = getBlocks(out)
    for (const p of pending) {
      const block = blocks[p.insertedAt]
      expect(hasCaptionStyle(block)).toBe(true)
      expect(isRed(block)).toBe(true)
    }
  })

  it('caption placeholder text contains figure ordinal', () => {
    const xml = wrap(imagePara())
    const { xml: out, pending } = detectAndInsertPlaceholders(xml)
    const captionPending = pending.find(p => p.kind === 'figure-caption')!
    const block = getBlocks(out)[captionPending.insertedAt]
    expect(blockText(block)).toMatch(/Figura 1/)
  })

  it('skips caption when existing Caption-styled paragraph is before image', () => {
    const xml = wrap(captionPara('Figura 1 — My caption') + imagePara() + para('plain after'))
    const { pending } = detectAndInsertPlaceholders(xml)
    expect(pending.find(p => p.kind === 'figure-caption')).toBeUndefined()
    expect(pending.find(p => p.kind === 'figure-source')).toBeDefined()
  })

  it('skips caption when labelled paragraph is before image (text match)', () => {
    const xml = wrap(para('Figura 1 — unlabelled but text matches') + imagePara() + para('plain after'))
    const { pending } = detectAndInsertPlaceholders(xml)
    expect(pending.find(p => p.kind === 'figure-caption')).toBeUndefined()
  })

  it('styles unlabelled-but-text-matching neighbour as Caption without inserting pending', () => {
    const xml = wrap(imagePara() + para('Fonte: elaborado pelo autor'))
    const { xml: out, pending } = detectAndInsertPlaceholders(xml)
    expect(pending.find(p => p.kind === 'figure-source')).toBeUndefined()
    // The source para should now have Caption style
    const blocks = getBlocks(out)
    const sourceBlock = blocks.find(b => blockText(b).includes('Fonte:'))!
    expect(hasCaptionStyle(sourceBlock)).toBe(true)
  })

  it('handles image at the very start of the document', () => {
    const xml = wrap(imagePara() + para('plain after'))
    const { pending } = detectAndInsertPlaceholders(xml)
    expect(pending.find(p => p.kind === 'figure-caption')).toBeDefined()
  })

  it('handles image at the very end of the document', () => {
    const xml = wrap(para('plain before') + imagePara())
    const { pending } = detectAndInsertPlaceholders(xml)
    expect(pending.find(p => p.kind === 'figure-source')).toBeDefined()
  })

  it('tracks ordinals correctly across two images', () => {
    const xml = wrap(imagePara() + para('between') + imagePara())
    const { pending } = detectAndInsertPlaceholders(xml)
    const captions = pending.filter(p => p.kind === 'figure-caption').sort((a, b) => a.ordinal - b.ordinal)
    expect(captions).toHaveLength(2)
    expect(captions[0].ordinal).toBe(1)
    expect(captions[1].ordinal).toBe(2)
    expect(captions[0].id).toBe('figure-1-caption')
    expect(captions[1].id).toBe('figure-2-caption')
  })

  it('insertedAt indices are correct in the returned xml', () => {
    const xml = wrap(imagePara())
    const { xml: out, pending } = detectAndInsertPlaceholders(xml)
    const blocks = getBlocks(out)
    for (const p of pending) {
      expect(blocks[p.insertedAt]).toBeDefined()
      expect(isRed(blocks[p.insertedAt])).toBe(true)
    }
  })

  it('inserts table-caption placeholder for table with no caption above', () => {
    const xml = wrap(para('intro') + tableBlock() + para('after'))
    const { pending } = detectAndInsertPlaceholders(xml)
    const cap = pending.find(p => p.kind === 'table-caption')
    expect(cap).toBeDefined()
    expect(cap?.id).toBe('table-1-caption')
  })

  it('skips table-caption when Tabela label present above', () => {
    const xml = wrap(para('Tabela 1 — Resultados') + tableBlock() + para('after'))
    const { pending } = detectAndInsertPlaceholders(xml)
    expect(pending.find(p => p.kind === 'table-caption')).toBeUndefined()
  })

  it('does not insert placeholders between adjacent stacked images', () => {
    const xml = wrap(imagePara() + imagePara())
    const { pending } = detectAndInsertPlaceholders(xml)
    // No pending should reference positions between the two images
    // (conservative: stacked images don't get placeholders between them)
    const ids = pending.map(p => p.id)
    // figure-1-source and figure-2-caption would be the "between" entries — they shouldn't exist
    expect(ids).not.toContain('figure-1-source')
    expect(ids).not.toContain('figure-2-caption')
  })
})

// ── fillContent ───────────────────────────────────────────────────────────────

describe('fillContent', () => {
  it('replaces placeholder with user text, no red color', () => {
    const xml = wrap(imagePara())
    const { xml: withPlaceholders, pending } = detectAndInsertPlaceholders(xml)
    const cap = pending.find(p => p.kind === 'figure-caption')!
    const filled = fillContent(withPlaceholders, pending, { [cap.id]: 'My caption text' })
    const block = getBlocks(filled)[cap.insertedAt]
    expect(blockText(block)).toBe('My caption text')
    expect(isRed(block)).toBe(false)
    expect(hasCaptionStyle(block)).toBe(true)
  })

  it('partial fill leaves other placeholders untouched', () => {
    const xml = wrap(imagePara())
    const { xml: withPlaceholders, pending } = detectAndInsertPlaceholders(xml)
    const [cap, src] = pending.sort((a, b) => a.insertedAt - b.insertedAt)
    const filled = fillContent(withPlaceholders, pending, { [cap.id]: 'Caption text' })
    const srcBlock = getBlocks(filled)[src.insertedAt]
    expect(isRed(srcBlock)).toBe(true)
  })

  it('no fills → xml unchanged', () => {
    const xml = wrap(imagePara())
    const { xml: withPlaceholders, pending } = detectAndInsertPlaceholders(xml)
    const filled = fillContent(withPlaceholders, pending, {})
    expect(filled).toBe(withPlaceholders)
  })
})

// ── removeContent ─────────────────────────────────────────────────────────────

describe('removeContent', () => {
  it('replaces placeholder with empty paragraph', () => {
    const xml = wrap(imagePara())
    const { xml: withPlaceholders, pending } = detectAndInsertPlaceholders(xml)
    const cap = pending.find(p => p.kind === 'figure-caption')!
    const removed = removeContent(withPlaceholders, pending, [cap.id])
    const block = getBlocks(removed)[cap.insertedAt]
    expect(block).toBe('<w:p/>')
  })

  it('does not remove untargeted placeholders', () => {
    const xml = wrap(imagePara())
    const { xml: withPlaceholders, pending } = detectAndInsertPlaceholders(xml)
    const cap = pending.find(p => p.kind === 'figure-caption')!
    const src = pending.find(p => p.kind === 'figure-source')!
    const removed = removeContent(withPlaceholders, pending, [cap.id])
    const srcBlock = getBlocks(removed)[src.insertedAt]
    expect(isRed(srcBlock)).toBe(true)
  })
})
