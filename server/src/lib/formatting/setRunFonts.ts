/**
 * Stamp an explicit run font on every `<w:r>` in document.xml.
 *
 * Step A already sets the family on the styles + docDefaults and strips direct run
 * fonts, which is correct OOXML — Word and LibreOffice render it right by inheritance.
 * But **Google Docs** remaps Word's built-in styles (`Normal`, `Title`, `Heading1/2/3`)
 * to its own and substitutes its theme font, ignoring the inherited family — so the body
 * and headings render in the wrong font there (only unmapped custom styles are honored).
 *
 * Direct run formatting wins over Google Docs' style remap, so writing the font onto each
 * run forces the correct family everywhere, in every consumer, with no effect on Word /
 * LibreOffice (they already showed the same font). Runs created by later passes (Step C
 * references, Step P proofreading, caption placeholders) are why this runs LAST, not in
 * Step A — every final run gets the family.
 */

const rFontsTag = (fam: string) => `<w:rFonts w:ascii="${fam}" w:hAnsi="${fam}" w:cs="${fam}"/>`

/** Ensure one run's `<w:rPr>` carries `<w:rFonts>` (first child, after `<w:rStyle>`). */
function ensureRunFont(inner: string, rf: string): string {
  if (inner.startsWith('<w:rPr>')) {
    const end = inner.indexOf('</w:rPr>')
    let rpr = inner.slice('<w:rPr>'.length, end).replace(/<w:rFonts\b[^>]*\/>/g, '')
    // CT_RPr order: rStyle then rFonts — insert after an existing rStyle, else first.
    rpr = /^<w:rStyle\b[^>]*\/>/.test(rpr)
      ? rpr.replace(/^(<w:rStyle\b[^>]*\/>)/, `$1${rf}`)
      : rf + rpr
    return `<w:rPr>${rpr}</w:rPr>${inner.slice(end + '</w:rPr>'.length)}`
  }
  if (inner.startsWith('<w:rPr/>')) {
    return `<w:rPr>${rf}</w:rPr>${inner.slice('<w:rPr/>'.length)}`
  }
  return `<w:rPr>${rf}</w:rPr>${inner}` // run had no rPr
}

/** Write `fam` as the explicit font of every run in the document. */
export function setRunFonts(documentXml: string, fam: string): string {
  const rf = rFontsTag(fam)
  return documentXml.replace(
    /<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g,
    (_full, attrs: string, inner: string) => `<w:r${attrs}>${ensureRunFont(inner, rf)}</w:r>`,
  )
}
