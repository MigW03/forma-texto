import { CAPTION_STYLE } from './guidelines'
import { getBlocks, isParagraph, blockText, setParagraphStyle, replaceBlocks, addKeepNext } from './blocks'
import { escapeXml } from './xmlText'

/**
 * Deterministic image-caption pass.
 *
 * For each image, the caption above and the source below are styled only when their
 * TEXT identifies them — we never style a neighbor by position alone (that would
 * shrink ordinary body text wrapped around an inline image):
 *   - the nearest paragraph BEFORE, when it opens with a figure label
 *     ("Figura 1 — …", "Imagem 2 - …", "Gráfico 3: …");
 *   - the nearest paragraph AFTER, when it opens with a source label
 *     ("Fonte: …", "Fonte — …").
 *
 * "Nearest" skips up to a few BLANK paragraphs: authors often leave a blank line
 * between the "Figura N" line and the image, so the caption is not strictly
 * adjacent. We skip only empty paragraphs (never real text), so body text is still
 * never mistaken for a caption.
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

/** True when the block is a table. */
export const isTableBlock = (b: string) => /^<w:tbl\b/.test(b)

/** Figure-type label words, e.g. "Figura", "Imagem", "Gráfico" … */
const FIGURE_LABEL_WORDS = 'figura|imagem|gr[aá]fico|foto(?:grafia)?|ilustra[cç][aã]o|desenho|fluxograma|esquema|mapa|gravura|quadro'
/** Table-type label words: "Tabela", "Quadro". */
const TABLE_LABEL_WORDS = 'tabela|quadro'
/** A label number, incl. sub-numbers like "3.1". */
const LABEL_NUM = '\\d+(?:[.\\-–—]\\d+)*'

/**
 * Figure caption label at the start of a line: a figure-type word + number +
 * separator, e.g. "Figura 1 — ", "Imagem 2 - ", "Gráfico 3: ". Case-insensitive.
 */
export const FIGURE_LABEL_RE = new RegExp(`^(?:${FIGURE_LABEL_WORDS})\\s+${LABEL_NUM}\\s*[-–—:.]`, 'i')

/** Table caption label at the start of a line: "Tabela 1 — ", "Quadro 2: ", etc. */
export const TABLE_LABEL_RE = new RegExp(`^(?:${TABLE_LABEL_WORDS})\\s+${LABEL_NUM}\\s*[-–—:.]`, 'i')

/** Source label at the start of a line: "Fonte:", "Fonte —", "Fonte - ". */
export const SOURCE_LABEL_RE = /^fonte\s*[:.\-–—]/i

/** Matches a leading "Fonte" + optional space + "." (but not ":", "-", "—") to rewrite. */
const FONTE_DOT_RE = /^(\s*)(fonte)(\s*)\.(\s*)/i

/** Matches a leading figure/table label using "." as its separator, to rewrite to ":". */
const FIGURE_LABEL_DOT_RE = new RegExp(`^(\\s*)(${FIGURE_LABEL_WORDS})(\\s+)(${LABEL_NUM})(\\s*)\\.(\\s*)`, 'i')
const TABLE_LABEL_DOT_RE = new RegExp(`^(\\s*)(${TABLE_LABEL_WORDS})(\\s+)(${LABEL_NUM})(\\s*)\\.(\\s*)`, 'i')

/**
 * ABNT requires "Fonte: …" with a colon. Authors sometimes type "Fonte." instead —
 * normalize the punctuation in the paragraph's first text run, preserving everything
 * else (case of "Fonte", spacing, the rest of the line). No-op when the line already
 * uses the correct separator or doesn't start with "Fonte" at all.
 */
function normalizeSourceDot(block: string): string {
  let done = false
  return block.replace(/(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/, (whole, open: string, text: string, close: string) => {
    if (done || !FONTE_DOT_RE.test(text)) return whole
    done = true
    return open + text.replace(FONTE_DOT_RE, (_m, lead: string, word: string, mid: string, trail: string) => `${lead}${word}${mid}:${trail}`) + close
  })
}

/**
 * Same idea as `normalizeSourceDot`, but for a figure/table label + number, e.g.
 * "Figura 12. Respostas" → "Figura 12: Respostas". Sub-number dots ("12.1") are
 * untouched since they sit inside the captured number group, not the separator.
 */
function normalizeLabelDot(block: string, dotRe: RegExp): string {
  let done = false
  return block.replace(/(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/, (whole, open: string, text: string, close: string) => {
    if (done || !dotRe.test(text)) return whole
    done = true
    return open + text.replace(
      dotRe,
      (_m, lead: string, word: string, sp1: string, num: string, sp2: string, trail: string) => `${lead}${word}${sp1}${num}${sp2}:${trail}`,
    ) + close
  })
}

/** Build a clean, single-run Caption-styled paragraph from plain text. */
function buildCaptionParagraph(text: string, keepNext: boolean): string {
  const kn = keepNext ? '<w:keepNext/>' : '' // after pStyle → schema-valid CT_PPr order
  return `<w:p><w:pPr><w:pStyle w:val="${CAPTION_STYLE}"/>${kn}</w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

/** Rewrite a leading "Figura/Tabela N." or "Fonte." in PLAIN text to use a colon. */
function normalizePlainLabelDot(text: string, words: string | null): string {
  if (words === null) return text.replace(/^(fonte)(\s*)\.(\s*)/i, (_m, word, sp, trail) => `${word}:${trail}`)
  const re = new RegExp(`^(${words})(\\s+)(${LABEL_NUM})(\\s*)\\.(\\s*)`, 'i')
  return text.replace(re, (_m, word, sp1, num, sp2, trail) => `${word}${sp1}${num}${sp2}:${trail}`)
}

/** Matches a single run element, self-closing or with content. */
const RUN_RE = /<w:r\b[^>]*\/>|<w:r\b[^>]*>[\s\S]*?<\/w:r>/g

/** Visible text of a single run (its `<w:t>` content, tags stripped). */
const runText = (run: string): string =>
  (run.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('')

/**
 * Some exported docs (notably Google Docs) put an image's caption/source text as an
 * extra run in the SAME paragraph as the `<w:drawing>`, instead of its own paragraph
 * — e.g. one `<w:p>` holding [drawing run][" Fonte: Imagem da autora" run]. That
 * defeats every neighbor-paragraph caption check in this file (and in
 * `missingInputs.ts`), since there IS no neighbor paragraph to find.
 *
 * Splits such a paragraph into up to three: a Caption-styled line for text found
 * BEFORE the drawing run (if it's a figure label), the image alone, and a
 * Caption-styled line for text found AFTER the drawing run (if it's a source line).
 * Returns null when there's nothing to split — paragraph has no embedded label/
 * source text worth pulling into its own line.
 */
function splitEmbeddedCaption(block: string): string | null {
  const runs = block.match(RUN_RE) ?? []
  if (runs.length < 2) return null
  const imageRunIdx = runs.findIndex(r => IMAGE_RE.test(r))
  if (imageRunIdx < 0) return null

  const beforeText = runs.slice(0, imageRunIdx).map(runText).join('').trim()
  const afterText = runs.slice(imageRunIdx + 1).map(runText).join('').trim()
  const hasCaptionBefore = beforeText !== '' && FIGURE_LABEL_RE.test(beforeText)
  const hasSourceAfter = afterText !== '' && SOURCE_LABEL_RE.test(afterText)
  if (!hasCaptionBefore && !hasSourceAfter) return null

  const openMatch = block.match(/^<w:p\b[^>]*>/)
  const open = openMatch ? openMatch[0] : '<w:p>'
  const pPrMatch = block.match(/<w:pPr\b[^>]*\/>|<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)
  const pPr = pPrMatch ? pPrMatch[0] : ''

  let image = `${open}${pPr}${runs[imageRunIdx]}</w:p>`
  if (hasSourceAfter) image = addKeepNext(image) // keep the image with the source line below

  const before = hasCaptionBefore ? buildCaptionParagraph(normalizePlainLabelDot(beforeText, FIGURE_LABEL_WORDS), true) : ''
  const after = hasSourceAfter ? buildCaptionParagraph(normalizePlainLabelDot(afterText, null), false) : ''

  return `${before}${image}${after}`
}

/** How many blank paragraphs may sit between an image and its caption/source line. */
export const MAX_CAPTION_GAP = 3

/**
 * Max non-blank paragraphs above the first text to scan when looking for the
 * figure label. Real ABNT captions can span many lines (long titles, subtitles,
 * description paragraphs); 8 covers all observed cases without risking pulling in
 * distant unrelated body text.
 */
export const MAX_CONTINUATION_LINES = 8

/**
 * From `start`, walk in `dir` (-1 up / +1 down) skipping up to `MAX_CAPTION_GAP`
 * BLANK paragraphs, and return the index of the first paragraph that has text.
 * Returns -1 if it first hits a table/another image, the `stopAt` freeze, the
 * document edge, or more than `MAX_CAPTION_GAP` blanks — i.e. there is no
 * caption/source candidate near this image.
 *
 * Used for source-line detection below the image (single-line, no continuation).
 */
export function nearestCaptionLine(blocks: string[], start: number, dir: -1 | 1, stopAt = Infinity): number {
  let skipped = 0
  for (let j = start; j >= 0 && j < blocks.length && j < stopAt; j += dir) {
    const b = blocks[j]
    if (!isParagraph(b) || isImageParagraph(b)) return -1 // table / another image — stop
    if (blockText(b).trim() === '') {
      if (++skipped > MAX_CAPTION_GAP) return -1
      continue
    }
    return j
  }
  return -1
}

/**
 * Find all paragraph indices above `imageIdx` that constitute the figure caption,
 * returned in document order (label first, then any continuation lines).
 *
 * Handles two common patterns that the single-line scan misses:
 *  1. Multi-line captions — the label and one or two continuation paragraphs appear
 *     consecutively above the image with no blank line between them:
 *       "Figura 1 — Long title that wraps"
 *       "onto a second paragraph of the same caption"
 *       [image]
 *  2. Gap + label — the label is separated from the image by blank lines (existing
 *     behaviour, carried over from `nearestCaptionLine`).
 *
 * Scanning stops at a blank line (between continuation lines), at another image,
 * or at a table — preventing the label of a previous figure from "leaking" across
 * those natural barriers into an unrelated image.
 *
 * Returns `[]` when no figure label is found within the search window.
 */
export function findCaptionsAbove(blocks: string[], imageIdx: number, stopAt = Infinity): number[] {
  // Phase 1 — skip leading blank paragraphs above the image to find the first text.
  let j = imageIdx - 1
  let blanks = 0
  let firstTextIdx = -1
  while (j >= 0 && j < stopAt) {
    const b = blocks[j]
    if (!isParagraph(b) || isImageParagraph(b)) return []
    if (blockText(b).trim() === '') {
      if (++blanks > MAX_CAPTION_GAP) return []
      j--
      continue
    }
    firstTextIdx = j
    break
  }
  if (firstTextIdx < 0) return []

  // Phase 2 — if the first text paragraph IS the figure label, we're done.
  if (FIGURE_LABEL_RE.test(blockText(blocks[firstTextIdx]))) {
    return [firstTextIdx]
  }

  // Phase 3 — the first text might be a continuation line of a multi-line caption.
  // Scan up to MAX_CONTINUATION_LINES non-blank paragraphs to find the label.
  // When a single blank line is encountered, we peek one level further: if the
  // paragraph immediately above the blank IS a figure label we include it (authors
  // often leave a blank line between the label and a description paragraph before
  // the image). Two consecutive blanks, a table, or another image stop the search.
  const continuations: number[] = [firstTextIdx]
  j = firstTextIdx - 1
  while (j >= 0 && j < stopAt && continuations.length <= MAX_CONTINUATION_LINES) {
    const b = blocks[j]
    if (!isParagraph(b) || isImageParagraph(b)) break
    const t = blockText(b).trim()
    if (t === '') {
      // Single blank: check if the paragraph immediately above is the figure label.
      const peek = j - 1
      if (peek >= 0 && peek < stopAt) {
        const above = blocks[peek]
        if (isParagraph(above) && FIGURE_LABEL_RE.test(blockText(above).trim())) {
          return [peek, ...continuations.slice().reverse()]
        }
      }
      break // no label immediately above the blank — stop
    }
    if (FIGURE_LABEL_RE.test(t)) {
      // Found the label. Return [labelIdx, ...continuations] in document order.
      return [j, ...continuations.slice().reverse()]
    }
    continuations.push(j)
    j--
  }

  return []
}

/**
 * Style the figure label before an image and the source line after it as
 * captions. A neighbor is captioned only when its text matches the relevant
 * label; tables and stacked images never match (no label text). Existing labels
 * also get normalized: a "." separator becomes ":" (ABNT), and a caption/source
 * embedded as an extra run in the image's own paragraph is split onto its own line.
 */
export function formatCaptions(documentXml: string, stopAt = Infinity): string {
  const blocks = getBlocks(documentXml)
  if (!blocks.length) return documentXml

  const byIndex = new Map<number, string>()

  blocks.forEach((b, i) => {
    if (i >= stopAt) return // appendix/annex frozen — don't caption its images
    if (!isImageParagraph(b)) return

    // Some exports put the caption/source as an extra run in the image's own
    // paragraph — split it onto its own line(s) before anything else, and skip the
    // normal neighbor-paragraph search for this image (there's nothing to find).
    const split = splitEmbeddedCaption(b)
    if (split) {
      byIndex.set(i, split)
      return
    }

    // Above the image: figure label plus any continuation lines.
    const captionIdxs = findCaptionsAbove(blocks, i, stopAt)
    captionIdxs.forEach((idx, pos) => {
      let block = pos === 0 ? normalizeLabelDot(blocks[idx], FIGURE_LABEL_DOT_RE) : blocks[idx]
      block = setParagraphStyle(block, CAPTION_STYLE)
      block = addKeepNext(block) // each caption line keeps with the line/image below it
      byIndex.set(idx, block)
    })

    // keepNext on every blank paragraph between the last caption line and the image —
    // a blank paragraph without keepNext breaks the chain, letting the page split
    // between the caption group and the image.
    if (captionIdxs.length > 0) {
      const lastCaptionIdx = captionIdxs[captionIdxs.length - 1]
      for (let k = lastCaptionIdx + 1; k < i; k++) {
        byIndex.set(k, addKeepNext(byIndex.get(k) ?? blocks[k]))
      }
    }

    // Image paragraph: keepNext so it sticks to the source line below.
    byIndex.set(i, addKeepNext(byIndex.get(i) ?? b))

    // Below the image: source line ("Fonte: …"). Single-line only.
    const srcIdx = nearestCaptionLine(blocks, i + 1, +1, stopAt)
    if (srcIdx >= 0 && SOURCE_LABEL_RE.test(blockText(blocks[srcIdx]))) {
      byIndex.set(srcIdx, setParagraphStyle(normalizeSourceDot(blocks[srcIdx]), CAPTION_STYLE))
    }
  })

  // Tables: caption above (single line), source below (single line). Captions can't
  // be embedded in the table's own block (a `<w:tbl>` has no text runs of its own),
  // so there's no split case here — only styling + dot normalization.
  blocks.forEach((b, i) => {
    if (i >= stopAt) return
    if (!isTableBlock(b)) return

    const aboveIdx = nearestCaptionLine(blocks, i - 1, -1, stopAt)
    if (aboveIdx >= 0 && TABLE_LABEL_RE.test(blockText(blocks[aboveIdx]))) {
      let block = normalizeLabelDot(byIndex.get(aboveIdx) ?? blocks[aboveIdx], TABLE_LABEL_DOT_RE)
      block = setParagraphStyle(block, CAPTION_STYLE)
      block = addKeepNext(block) // keep the "Tabela N —" label with the table below it
      byIndex.set(aboveIdx, block)
    }

    const belowIdx = nearestCaptionLine(blocks, i + 1, +1, stopAt)
    if (belowIdx >= 0 && SOURCE_LABEL_RE.test(blockText(blocks[belowIdx]))) {
      const block = normalizeSourceDot(byIndex.get(belowIdx) ?? blocks[belowIdx])
      byIndex.set(belowIdx, setParagraphStyle(block, CAPTION_STYLE))
    }
  })

  if (byIndex.size === 0) return documentXml
  return replaceBlocks(documentXml, byIndex)
}
