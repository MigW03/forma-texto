import { CAPTION_STYLE } from './guidelines'
import { getBlocks, isParagraph, blockText, setParagraphStyle, replaceBlocks } from './blocks'

/**
 * Deterministic image-caption pass.
 *
 * For each image, two adjacent paragraphs may be its caption, and each is only
 * styled when its TEXT identifies it — we do not style a neighbor by position
 * alone (that would shrink ordinary body text wrapped around an inline image):
 *   - the paragraph immediately BEFORE, when it opens with a figure label
 *     ("Figura 1 — …", "Imagem 2 - …", "Gráfico 3: …");
 *   - the paragraph immediately AFTER, when it opens with a source label
 *     ("Fonte: …", "Fonte — …").
 *
 * A matched paragraph gets CAPTION_STYLE — centered, 10pt, single line spacing
 * (the style, built in `rewriteStyles`, carries those values). Like Step B this
 * only swaps `<w:pStyle>`; layout lives in the style, and the merge is by
 * absolute block index via `replaceBlocks`, so nothing else is touched.
 */

/** Containers that carry an embedded picture/drawing/OLE object in a paragraph. */
const IMAGE_RE = /<w:drawing\b|<w:pict\b|<w:object\b/

/** True when the block is a paragraph that embeds an image. */
export const isImageParagraph = (b: string) => isParagraph(b) && IMAGE_RE.test(b)

/**
 * Figure caption label at the start of a line: a figure-type word + number +
 * separator, e.g. "Figura 1 — ", "Imagem 2 - ", "Gráfico 3: ". Case-insensitive.
 */
export const FIGURE_LABEL_RE =
  /^(?:figura|imagem|gr[aá]fico|foto(?:grafia)?|ilustra[cç][aã]o|desenho|fluxograma|esquema|mapa|gravura|quadro)\s+\d+(?:[.\-–—]\d+)*\s*[-–—:]/i

/** Source label at the start of a line: "Fonte:", "Fonte —", "Fonte - ". */
export const SOURCE_LABEL_RE = /^fonte\s*[:.\-–—]/i

/**
 * Style the figure label before an image and the source line after it as
 * captions. A neighbor is captioned only when its text matches the relevant
 * label; tables and stacked images never match (no label text).
 */
export function formatCaptions(documentXml: string): string {
  const blocks = getBlocks(documentXml)
  if (!blocks.length) return documentXml

  const byIndex = new Map<number, string>()
  const tagIfLabelled = (j: number, re: RegExp) => {
    if (j < 0 || j >= blocks.length) return
    const b = blocks[j]
    if (!isParagraph(b) || isImageParagraph(b)) return
    if (!re.test(blockText(b))) return
    byIndex.set(j, setParagraphStyle(b, CAPTION_STYLE))
  }

  blocks.forEach((b, i) => {
    if (!isImageParagraph(b)) return
    tagIfLabelled(i - 1, FIGURE_LABEL_RE) // "Figura 1 — …" above the image
    tagIfLabelled(i + 1, SOURCE_LABEL_RE) // "Fonte: …" below the image
  })

  if (byIndex.size === 0) return documentXml
  return replaceBlocks(documentXml, byIndex)
}
