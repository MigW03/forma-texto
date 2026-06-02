/**
 * Step A — strip direct formatting overrides from document.xml.
 *
 * Removes inline LAYOUT properties so the named styles (from styles.xml) cascade
 * correctly. Preserves SEMANTIC properties: bold, italic, underline, color,
 * vertical align, highlights, hyperlinks — those carry meaning the author chose.
 *
 * Implements formattingPlan.md Step 2.3.
 */

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

export function stripDirectOverrides(documentXml: string): string {
  let xml = documentXml
  for (const tag of LAYOUT_TAGS) {
    // self-closing form: <w:sz w:val="28"/>
    xml = xml.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'g'), '')
    // paired form (defensive — these are normally empty elements): <w:sz ...></w:sz>
    xml = xml.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '')
  }
  return xml
}
