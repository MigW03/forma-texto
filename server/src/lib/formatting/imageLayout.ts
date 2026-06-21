import { getGuideline, type Guideline } from './guidelines'
import { getBlocks, isParagraph, replaceBlocks } from './blocks'

/**
 * Deterministic image-layout pass.
 *
 * Authors size images deliberately (a small logo, a pair of side-by-side figures, a
 * full-width chart), and the guidelines specify no image size — so this pass PRESERVES
 * each image's author-chosen width. The one thing it enforces: an INLINE image must not
 * be wider than the page content area, or it overflows the right margin (and leaks off
 * the page in the viewer / PDF). So an image is shrunk to fit ONLY when it overflows;
 * it is never enlarged. The image's paragraph is centered.
 *
 * Only `<wp:inline>` drawings are touched — anchored/floating images (`<wp:anchor>`)
 * carry their own positioning and text-wrap, so resizing or centering them could
 * break the layout. Tables and OLE objects are left alone.
 *
 * Sizes live in EMU (1 inch = 914400 EMU = 1440 twips → 1 twip = 635 EMU). We read
 * the primary `<wp:extent>` for the current display size; when it exceeds the content
 * width we compute one shrink factor and apply it to every `cx`/`cy` pair in the
 * drawing (`wp:extent` and the inner `a:ext`). `<wp:effectExtent>` uses l/t/r/b and
 * `<a:off>` uses x/y, so neither is affected.
 */

/** EMU per twip (1440 twips/in, 914400 EMU/in). */
const EMU_PER_TWIP = 635

/** Default A4 page width in twips, used when the document has no <w:pgSz>. */
const DEFAULT_PAGE_WIDTH_TWIPS = 11906

const INLINE_DRAWING_RE = /<w:drawing\b[\s\S]*?<\/w:drawing>/g

/** Read the page width (twips) from the first <w:pgSz>, falling back to A4. */
function pageWidthTwips(documentXml: string): number {
  const m = documentXml.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"/)
  return m ? parseInt(m[1], 10) : DEFAULT_PAGE_WIDTH_TWIPS
}

/** Scale every cx/cy attribute in a drawing fragment by `scale` (rounded). */
function scaleExtents(drawing: string, scale: number): string {
  return drawing.replace(/\b(cx|cy)="(\d+)"/g, (_m, attr: string, val: string) => {
    const scaled = Math.max(1, Math.round(parseInt(val, 10) * scale))
    return `${attr}="${scaled}"`
  })
}

/** Set (or replace) a paragraph's justification, creating <w:pPr> if absent. */
function centerParagraph(p: string): string {
  const jc = '<w:jc w:val="center"/>'
  if (/<w:jc\b[^>]*\/>/.test(p)) {
    return p.replace(/<w:jc\b[^>]*\/>/, jc)
  }
  if (/<w:pPr\b[^>]*>/.test(p)) {
    // jc precedes the paragraph-mark <w:rPr>; insert before it when present.
    if (/<w:rPr\b/.test(p.slice(0, p.indexOf('</w:pPr>')))) {
      return p.replace(/(<w:rPr\b)/, `${jc}$1`)
    }
    return p.replace('</w:pPr>', `${jc}</w:pPr>`)
  }
  if (/<w:pPr\b[^>]*\/>/.test(p)) {
    return p.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr>${jc}</w:pPr>`)
  }
  return p.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${jc}</w:pPr>`)
}

/**
 * Resize inline images to `IMAGE_WIDTH_FRACTION` of the page content width and
 * center their paragraphs. Returns the document unchanged when no inline image
 * needs adjusting.
 */
export function formatImages(documentXml: string, guideline: Guideline, stopAt = Infinity): string {
  const blocks = getBlocks(documentXml)
  if (!blocks.length) return documentXml

  const { left, right } = getGuideline(guideline).margins
  const contentTwips = pageWidthTwips(documentXml) - left - right
  if (contentTwips <= 0) return documentXml
  const maxWidthEmu = contentTwips * EMU_PER_TWIP // 100% of content width — the overflow cap

  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    if (i >= stopAt) return
    if (!isParagraph(b) || !b.includes('<wp:inline')) return

    let changed = false
    const out = b.replace(INLINE_DRAWING_RE, drawing => {
      if (!drawing.includes('<wp:inline')) return drawing
      const ext = drawing.match(/<wp:extent\b[^>]*\bcx="(\d+)"/)
      if (!ext) return drawing
      const currentCx = parseInt(ext[1], 10)
      if (currentCx <= 0) return drawing
      changed = true // mark so the paragraph is centered, even if the size is preserved
      // Preserve the author's size; shrink ONLY when it would overflow the content
      // width. Never enlarge — an intentionally small figure stays small.
      return currentCx > maxWidthEmu ? scaleExtents(drawing, maxWidthEmu / currentCx) : drawing
    })

    if (changed) byIndex.set(i, centerParagraph(out))
  })

  if (byIndex.size === 0) return documentXml
  return replaceBlocks(documentXml, byIndex)
}
