import type { GuidelineSpec } from './guidelines'

/**
 * Stamp the title/heading look (size, bold, caps) directly on every run inside a
 * Title or Heading1/2/3 paragraph.
 *
 * Step A defines size/bold/case on the built-in `Title` + `Heading1/2/3` *styles*,
 * which is correct OOXML — Word and LibreOffice render them right by inheritance.
 * But **Google Docs** remaps those built-in styles to its own and substitutes its
 * own size/weight, discarding the inherited style rPr — so the title and headings
 * import with the wrong size and lose their uppercase. (Same quirk `setRunFonts`
 * works around for the font family; that one already fixed the family, leaving size
 * + case.)
 *
 * Direct run formatting wins over Google Docs' style remap, so writing
 * `<w:sz>/<w:b>/<w:caps>` onto each heading run forces the correct look in every
 * consumer with no effect on Word/LibreOffice (they already showed it via the
 * style). `<w:caps>` keeps the fix non-destructive — the run text is untouched,
 * only its display is uppercased — matching how Step A applies case.
 *
 * Runs are made fully deterministic: any leftover bold/caps/size on a heading run
 * is stripped first, then the level's exact values are inserted (so an H3 that the
 * source bolded is normalized to the spec). Must run AFTER `setRunFonts` so the
 * props land just after the `<w:rFonts>` it adds, keeping CT_RPr order valid
 * (rStyle, rFonts, b, bCs, caps, sz, szCs).
 */

/** Direct rPr fragment in CT_RPr order (b, bCs, caps, sz, szCs). */
function fragment(bold: boolean, caps: boolean, sz: number): string {
  return (
    (bold ? '<w:b/><w:bCs/>' : '') +
    (caps ? '<w:caps/>' : '') +
    `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`
  )
}

/**
 * The direct fragment for a styled paragraph, or null if the style isn't one we
 * stamp. Covers the built-in styles Google Docs remaps and strips the rPr from:
 *  - `Title`         — always bold + UPPERCASE, body size (ABNT título).
 *  - `Heading1/2/3`  — per the spec's level look (bold/case), heading size.
 * (`ReferencesHeading`/`Caption` are CUSTOM styles GDocs honors — left alone.)
 */
function fragmentForStyle(g: GuidelineSpec, styleId: string): string | null {
  if (styleId === 'Title') return fragment(true, true, g.body.sz)
  const m = styleId.match(/^Heading([123])$/)
  if (!m) return null
  const lvl = g.heading.levels[Number(m[1]) as 1 | 2 | 3]
  return fragment(lvl.bold, lvl.case === 'upper', g.heading.sz)
}

/** Strip any existing bold/caps/size from an rPr's inner so the level's values win. */
function stripExisting(rpr: string): string {
  return rpr
    .replace(/<w:b\b[^>]*\/>/g, '')
    .replace(/<w:bCs\b[^>]*\/>/g, '')
    .replace(/<w:caps\b[^>]*\/>/g, '')
    .replace(/<w:smallCaps\b[^>]*\/>/g, '')
    .replace(/<w:sz\b[^>]*\/>/g, '')
    .replace(/<w:szCs\b[^>]*\/>/g, '')
}

/** Insert `frag` into one run's content, after `<w:rFonts>` (else rStyle, else front). */
function applyToRun(inner: string, frag: string): string {
  let rpr: string
  let rest: string
  if (inner.startsWith('<w:rPr>')) {
    const end = inner.indexOf('</w:rPr>')
    rpr = stripExisting(inner.slice('<w:rPr>'.length, end))
    rest = inner.slice(end + '</w:rPr>'.length)
  } else if (inner.startsWith('<w:rPr/>')) {
    rpr = ''
    rest = inner.slice('<w:rPr/>'.length)
  } else {
    rpr = ''
    rest = inner
  }

  const rFonts = rpr.match(/^.*?<w:rFonts\b[^>]*\/>/)
  if (rFonts) {
    rpr = rpr.slice(0, rFonts[0].length) + frag + rpr.slice(rFonts[0].length)
  } else if (/^<w:rStyle\b[^>]*\/>/.test(rpr)) {
    rpr = rpr.replace(/^(<w:rStyle\b[^>]*\/>)/, `$1${frag}`)
  } else {
    rpr = frag + rpr
  }

  return `<w:rPr>${rpr}</w:rPr>${rest}`
}

/** Stamp the title/heading look on every run inside a Title or Heading1/2/3 paragraph. */
export function setHeadingRunProps(documentXml: string, g: GuidelineSpec): string {
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const m = para.match(/<w:pStyle\s+w:val="(Title|Heading[123])"\s*\/>/)
    if (!m) return para
    const frag = fragmentForStyle(g, m[1])
    if (!frag) return para
    return para.replace(
      /<w:r\b([^>]*)>([\s\S]*?)<\/w:r>/g,
      (_full, attrs: string, inner: string) => `<w:r${attrs}>${applyToRun(inner, frag)}</w:r>`,
    )
  })
}
