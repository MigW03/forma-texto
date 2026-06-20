/**
 * Step A — strip direct formatting overrides from document.xml.
 *
 * Removes inline LAYOUT properties so the named styles (from styles.xml) cascade
 * correctly. Preserves SEMANTIC properties: bold, italic, underline, color,
 * vertical align, highlights, hyperlinks — those carry meaning the author chose.
 *
 * Implements formattingPlan.md Step 2.3.
 */

import { getBlocks, replaceBlocks } from './blocks'

// Layout-only properties to strip wherever they appear in document.xml.
// `\b` after the name prevents w:sz from matching w:szCs.
const LAYOUT_TAGS = [
  'w:sz',      // run font size
  'w:szCs',    // complex-script font size
  'w:rFonts',  // run font family
  'w:spacing', // paragraph line spacing / run char spacing
  'w:ind',     // paragraph indentation
  'w:jc',      // paragraph justification/alignment
]

/** Strip the layout tags from one chunk of XML (a whole doc or a single block). */
function stripChunk(xml: string): string {
  let out = xml
  for (const tag of LAYOUT_TAGS) {
    // self-closing form: <w:sz w:val="28"/>
    out = out.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'g'), '')
    // paired form (defensive — these are normally empty elements): <w:sz ...></w:sz>
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '')
  }
  return out
}

/**
 * Strip direct layout overrides. When `stopAt` is set (an appendix/annex boundary),
 * only blocks before it are stripped — the frozen section keeps its original direct
 * formatting (an annex reproduces a third-party document and must survive as-is).
 */
export function stripDirectOverrides(documentXml: string, stopAt = Infinity): string {
  if (!Number.isFinite(stopAt)) return stripChunk(documentXml)

  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  blocks.forEach((b, i) => {
    if (i >= stopAt) return
    const s = stripChunk(b)
    if (s !== b) byIndex.set(i, s)
  })
  return replaceBlocks(documentXml, byIndex)
}
