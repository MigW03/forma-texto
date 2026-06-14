/**
 * Normalizes list indentation in numbering.xml.
 *
 * Word's built-in default is 720 twips per level (≈ 1.27 cm), which makes
 * deeply-nested items very wide. We cap each level at STEP_TWIPS so the
 * hierarchy is still visible but the text stays closer to the left margin.
 *
 *   level 0 → left = 480 (≈ 0.85 cm), hanging = 240
 *   level 1 → left = 960 (≈ 1.69 cm), hanging = 240
 *   level 2 → left = 1440 (≈ 2.54 cm), hanging = 240
 *   ...
 */

const STEP = 480  // twips added per indent level (Word default = 720)
const HANG = 240  // hanging indent for all levels (keeps number/bullet separate from text)

/**
 * Rewrite all <w:lvl> indent values in numbering.xml to a compact, uniform
 * per-level step. Handles both <w:abstractNum> definitions and <w:lvlOverride>
 * entries (matched by the same <w:lvl> pattern).
 */
export function normalizeNumberingXml(xml: string): string {
  return xml.replace(
    /<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g,
    (match, attrs: string, body: string) => {
      const ilvlM = /\bw:ilvl="(\d+)"/.exec(attrs)
      if (!ilvlM) return match

      const ilvl = parseInt(ilvlM[1], 10)
      const left = (ilvl + 1) * STEP
      const indTag = `<w:ind w:left="${left}" w:hanging="${HANG}"/>`

      let newBody: string
      if (/<w:ind\b/.test(body)) {
        // Replace existing <w:ind .../> within the level
        newBody = body.replace(/<w:ind\b[^>]*\/>/, indTag)
      } else if (/<w:pPr\b[^>]*>/.test(body)) {
        // Inject after opening <w:pPr>
        newBody = body.replace(/(<w:pPr\b[^>]*>)/, `$1${indTag}`)
      } else if (/<w:pPr\b[^>]*\/>/.test(body)) {
        // Expand self-closing <w:pPr/>
        newBody = body.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr>${indTag}</w:pPr>`)
      } else {
        // No <w:pPr> at all — append one
        newBody = body + `<w:pPr>${indTag}</w:pPr>`
      }

      return `<w:lvl${attrs}>${newBody}</w:lvl>`
    },
  )
}
