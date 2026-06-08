import { getGuideline, REFERENCES_HEADING_STYLE, type Guideline, type GuidelineSpec } from './guidelines'

/**
 * Step A — rewrite styles.xml.
 *
 * Strategy: do NOT surgically edit messy existing styles. Build known-good
 * <w:style> blocks from the guideline spec and UPSERT them (replace if the
 * styleId exists, insert before </w:styles> otherwise). Guarantees the same
 * output regardless of how broken the source is. Anything `basedOn` Normal
 * then inherits the corrected base.
 *
 * Ported from n8nResources/nodes/02_rewrite_styles.js.
 */

const EMPTY_STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '</w:styles>'

function normalBlock(g: GuidelineSpec): string {
  return (
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
    '<w:name w:val="Normal"/>' +
    '<w:pPr>' +
    `<w:spacing w:after="0" w:line="${g.body.line}" w:lineRule="auto"/>` +
    `<w:ind w:firstLine="${g.body.firstLine}"/>` +
    `<w:jc w:val="${g.body.align}"/>` +
    '</w:pPr>' +
    '<w:rPr>' +
    `<w:rFonts w:ascii="${g.body.font}" w:hAnsi="${g.body.font}" w:cs="${g.body.font}"/>` +
    `<w:sz w:val="${g.body.sz}"/><w:szCs w:val="${g.body.sz}"/>` +
    '</w:rPr>' +
    '</w:style>'
  )
}

function headingBlock(g: GuidelineSpec, level: 1 | 2 | 3): string {
  const names = ['heading 1', 'heading 2', 'heading 3']
  const lvl = g.heading.levels[level]
  // Levels are distinguished by case + bold (ABNT uses one size for all headings).
  const caps = lvl.case === 'upper' ? '<w:caps/>' : '' // non-destructive uppercase display
  const bold = lvl.bold ? '<w:b/><w:bCs/>' : ''
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
    `<w:name w:val="${names[level - 1]}"/>` +
    '<w:basedOn w:val="Normal"/>' +
    '<w:next w:val="Normal"/>' +
    '<w:pPr>' +
    '<w:keepNext/><w:keepLines/>' +
    `<w:spacing w:before="240" w:after="120" w:line="${g.body.line}" w:lineRule="auto"/>` +
    '<w:ind w:firstLine="0"/>' + // headings have no first-line indent
    '<w:jc w:val="left"/>' + // headings never inherit body justification
    `<w:outlineLvl w:val="${level - 1}"/>` +
    '</w:pPr>' +
    '<w:rPr>' +
    `<w:rFonts w:ascii="${g.heading.font}" w:hAnsi="${g.heading.font}" w:cs="${g.heading.font}"/>` +
    caps +
    bold +
    `<w:sz w:val="${g.heading.sz}"/><w:szCs w:val="${g.heading.sz}"/>` +
    '</w:rPr>' +
    '</w:style>'
  )
}

/**
 * The document title. Deterministic rules (never the AI's job):
 *  - never indented (firstLine + left indent = 0)
 *  - displayed in UPPERCASE via <w:caps/> (non-destructive — text preserved)
 *  - bold, centered, same font family as the body.
 */
function titleBlock(g: GuidelineSpec): string {
  return (
    '<w:style w:type="paragraph" w:styleId="Title">' +
    '<w:name w:val="Title"/>' +
    '<w:basedOn w:val="Normal"/>' +
    '<w:next w:val="Normal"/>' +
    '<w:pPr>' +
    '<w:keepNext/>' +
    `<w:spacing w:before="240" w:after="240" w:line="${g.body.line}" w:lineRule="auto"/>` +
    '<w:ind w:left="0" w:firstLine="0"/>' + // never indented
    '<w:jc w:val="center"/>' +
    '</w:pPr>' +
    '<w:rPr>' +
    `<w:rFonts w:ascii="${g.body.font}" w:hAnsi="${g.body.font}" w:cs="${g.body.font}"/>` +
    '<w:caps/>' + // uppercase display
    '<w:b/><w:bCs/>' +
    `<w:sz w:val="${g.body.sz}"/><w:szCs w:val="${g.body.sz}"/>` +
    '</w:rPr>' +
    '</w:style>'
  )
}

/**
 * The references section heading (REFERÊNCIAS / References / ...). An ABNT
 * "título sem indicativo numérico": centered, bold, UPPERCASE, not indented.
 * Step B assigns this style to the detected references heading paragraph.
 */
function referencesHeadingBlock(g: GuidelineSpec): string {
  return (
    `<w:style w:type="paragraph" w:styleId="${REFERENCES_HEADING_STYLE}">` +
    '<w:name w:val="References Heading"/>' +
    '<w:basedOn w:val="Normal"/>' +
    '<w:next w:val="Normal"/>' +
    '<w:pPr>' +
    '<w:keepNext/>' +
    `<w:spacing w:before="240" w:after="240" w:line="${g.body.line}" w:lineRule="auto"/>` +
    '<w:ind w:left="0" w:firstLine="0"/>' +
    '<w:jc w:val="center"/>' +
    '</w:pPr>' +
    '<w:rPr>' +
    `<w:rFonts w:ascii="${g.body.font}" w:hAnsi="${g.body.font}" w:cs="${g.body.font}"/>` +
    '<w:caps/>' +
    '<w:b/><w:bCs/>' +
    `<w:sz w:val="${g.body.sz}"/><w:szCs w:val="${g.body.sz}"/>` +
    '</w:rPr>' +
    '</w:style>'
  )
}

/** Replace the <w:style> whose styleId matches, else insert before </w:styles>. */
function upsertStyle(xml: string, styleId: string, block: string): string {
  const re = new RegExp(`<w:style\\b[^>]*\\bw:styleId="${styleId}"[\\s\\S]*?</w:style>`, 'i')
  if (re.test(xml)) return xml.replace(re, block)
  return xml.replace('</w:styles>', block + '</w:styles>')
}

/**
 * Make `fam` the document-wide default font: drop any existing `<w:docDefaults>`
 * and insert a fresh one (correct schema position — right after `<w:styles>`).
 * Combined with clearing every style's own `<w:rFonts>`, this guarantees that any
 * paragraph style we do NOT rebuild (e.g. a custom body style) inherits the one
 * accepted family instead of carrying a second one.
 */
function setDocDefaultsFont(xml: string, fam: string): string {
  const rFonts = `<w:rFonts w:ascii="${fam}" w:hAnsi="${fam}" w:cs="${fam}"/>`
  const dd = `<w:docDefaults><w:rPrDefault><w:rPr>${rFonts}</w:rPr></w:rPrDefault></w:docDefaults>`
  const cleaned = xml.replace(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/, '')
  return cleaned.replace(/(<w:styles\b[^>]*>)/, `$1${dd}`)
}

/**
 * Rewrite styles.xml to the guideline.
 *
 * @param font - the single family to use everywhere (from `resolveDocumentFont`).
 *   Omitted → the guideline default. ABNT permits Times New Roman OR Arial but
 *   never mixed, so body, headings, title and references all use this one family.
 */
export function rewriteStyles(stylesXml: string | null, guideline: Guideline, font?: string): string {
  const base = getGuideline(guideline)
  const fam = font ?? base.body.font
  // Override only the font family; sizes/spacing/case stay from the guideline.
  const g: GuidelineSpec = {
    ...base,
    body: { ...base.body, font: fam },
    heading: { ...base.heading, font: fam },
  }

  let xml = stylesXml && stylesXml.includes('</w:styles>') ? stylesXml : EMPTY_STYLES

  // Enforce one family doc-wide: clear every style's font, then set the default.
  // (Our six rebuilt styles below re-add explicit `fam`; everything else inherits.)
  xml = xml.replace(/<w:rFonts\b[^>]*\/>/g, '')
  xml = setDocDefaultsFont(xml, fam)

  xml = upsertStyle(xml, 'Normal', normalBlock(g))
  xml = upsertStyle(xml, 'Title', titleBlock(g))
  xml = upsertStyle(xml, 'Heading1', headingBlock(g, 1))
  xml = upsertStyle(xml, 'Heading2', headingBlock(g, 2))
  xml = upsertStyle(xml, 'Heading3', headingBlock(g, 3))
  xml = upsertStyle(xml, REFERENCES_HEADING_STYLE, referencesHeadingBlock(g))

  return xml
}
