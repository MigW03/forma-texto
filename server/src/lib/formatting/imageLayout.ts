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

/**
 * Center an image paragraph AND zero its left/right/first-line indent, creating
 * `<w:pPr>` if absent.
 *
 * Centering alone is not enough: Step A's override-strip only removes the paragraph's
 * own DIRECT `<w:ind>` — it does not touch the STYLE cascade. An image paragraph left
 * with no override of its own still inherits the `Normal` style's first-line indent
 * (ABNT: 1.25cm, `rewriteStyles.ts`'s `normalBlock`). The image is already sized to
 * EXACTLY the content width (see `maxWidthEmu` above), so that inherited shift pushes
 * it right by the indent amount and its already-full-width box overflows the right
 * margin by the same amount — a real bug seen on a live document: the image rendered
 * shifted right and cut off past the margin. `<w:ind>` is always rebuilt fresh
 * (existing jc/ind stripped first) so a re-run is idempotent and the pair lands in
 * valid CT_PPr order (`ind` before `jc`) regardless of what was there before.
 */
function centerParagraph(p: string): string {
  const stripped = p.replace(/<w:ind\b[^>]*\/>/, '').replace(/<w:jc\b[^>]*\/>/, '')
  const props = '<w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="center"/>'
  if (/<w:pPr\b[^>]*>/.test(stripped)) {
    // jc/ind precede the paragraph-mark <w:rPr>; insert before it when present.
    if (/<w:rPr\b/.test(stripped.slice(0, stripped.indexOf('</w:pPr>')))) {
      return stripped.replace(/(<w:rPr\b)/, `${props}$1`)
    }
    return stripped.replace('</w:pPr>', `${props}</w:pPr>`)
  }
  if (/<w:pPr\b[^>]*\/>/.test(stripped)) {
    return stripped.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr>${props}</w:pPr>`)
  }
  return stripped.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${props}</w:pPr>`)
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
