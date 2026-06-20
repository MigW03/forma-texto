import { describe, it, expect } from 'vitest'
import { formatImages, IMAGE_WIDTH_FRACTION } from './imageLayout'

// ── helpers ──────────────────────────────────────────────────────────────────

// A4 page (11906 twips wide) with ABNT-ish 1701/1134 left/right margins via guideline.
// We use the 'apa' guideline (1in = 1440 twips all sides) for predictable math.
const wrap = (inner: string) =>
  `<w:document><w:body>${inner}` +
  `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>` +
  `</w:body></w:document>`

// Inline drawing with wp:extent + inner a:ext, both at the same size.
const inlineImage = (cx: number, cy: number) =>
  `<w:p><w:r><w:drawing>` +
  `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
  `<wp:extent cx="${cx}" cy="${cy}"/>` +
  `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
  `<a:graphic><a:graphicData><pic:pic><pic:spPr><a:xfrm>` +
  `<a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/>` +
  `</a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
  `</wp:inline></w:drawing></w:r></w:p>`

const anchorImage = (cx: number, cy: number) =>
  `<w:p><w:r><w:drawing>` +
  `<wp:anchor><wp:extent cx="${cx}" cy="${cy}"/>` +
  `<a:ext cx="${cx}" cy="${cy}"/></wp:anchor>` +
  `</w:drawing></w:r></w:p>`

const cxValues = (xml: string) =>
  [...xml.matchAll(/cx="(\d+)"/g)].map(m => parseInt(m[1], 10))

// APA margins: 1440 left + 1440 right. Content = 11906 - 2880 = 9026 twips.
// Target cx = round(9026 * 635 * 0.7) = 4011057.
const EXPECTED_TARGET = Math.round((11906 - 1440 - 1440) * 635 * IMAGE_WIDTH_FRACTION)

describe('formatImages', () => {
  it('scales an oversized inline image to the target content width', () => {
    const xml = wrap(inlineImage(8000000, 6000000))
    const out = formatImages(xml, 'apa')
    const widths = cxValues(out)
    // Both wp:extent and a:ext cx should be the target width
    expect(widths.every(w => w === EXPECTED_TARGET)).toBe(true)
  })

  it('preserves aspect ratio when scaling', () => {
    const cx = 8000000
    const cy = 6000000 // 4:3
    const xml = wrap(inlineImage(cx, cy))
    const out = formatImages(xml, 'apa')
    const extent = out.match(/<wp:extent cx="(\d+)" cy="(\d+)"/)!
    const newCx = parseInt(extent[1], 10)
    const newCy = parseInt(extent[2], 10)
    const ratio = newCy / newCx
    expect(ratio).toBeCloseTo(cy / cx, 3)
    expect(newCx).toBe(EXPECTED_TARGET)
  })

  it('scales up a small inline image to the target width', () => {
    const xml = wrap(inlineImage(500000, 500000))
    const out = formatImages(xml, 'apa')
    expect(cxValues(out)[0]).toBe(EXPECTED_TARGET)
  })

  it('centers the image paragraph', () => {
    const xml = wrap(inlineImage(8000000, 6000000))
    const out = formatImages(xml, 'apa')
    expect(out).toContain('<w:jc w:val="center"/>')
  })

  it('leaves effectExtent (l/t/r/b) untouched', () => {
    const xml = wrap(inlineImage(8000000, 6000000))
    const out = formatImages(xml, 'apa')
    expect(out).toContain('<wp:effectExtent l="0" t="0" r="0" b="0"/>')
  })

  it('ignores anchored (floating) images', () => {
    const xml = wrap(anchorImage(8000000, 6000000))
    const out = formatImages(xml, 'apa')
    expect(cxValues(out)).toEqual([8000000, 8000000])
    expect(out).not.toContain('<w:jc')
  })

  it('returns the document unchanged when there are no images', () => {
    const xml = wrap('<w:p><w:r><w:t>just text</w:t></w:r></w:p>')
    expect(formatImages(xml, 'apa')).toBe(xml)
  })

  it('replaces an existing justification rather than duplicating it', () => {
    const img =
      `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:drawing>` +
      `<wp:inline><wp:extent cx="8000000" cy="6000000"/></wp:inline>` +
      `</w:drawing></w:r></w:p>`
    const out = formatImages(wrap(img), 'apa')
    expect((out.match(/<w:jc\b/g) ?? []).length).toBe(1)
    expect(out).toContain('<w:jc w:val="center"/>')
  })
})
