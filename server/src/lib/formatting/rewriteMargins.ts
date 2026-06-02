import { GUIDELINES, type Guideline } from './guidelines'

/**
 * Step A — rewrite page margins in document.xml.
 *
 * Updates the w:top/right/bottom/left attributes of every <w:pgMar> (one per
 * <w:sectPr> — body-level and any section-level) to the guideline twips.
 * Other pgMar attributes (header/footer/gutter) are preserved. If a sectPr has
 * no pgMar, one is inserted.
 *
 * Implements formattingPlan.md Step 2.4. (1cm ≈ 567 twips.)
 */

function setAttr(tag: string, name: string, value: number): string {
  const re = new RegExp(`(\\b${name})="[^"]*"`)
  if (re.test(tag)) return tag.replace(re, `$1="${value}"`)
  // attribute missing → add it just before the closing of the (self-closing) tag
  return tag.replace(/\s*\/?>$/, m => ` ${name}="${value}"${m}`)
}

export function rewriteMargins(documentXml: string, guideline: Guideline): string {
  const { top, right, bottom, left } = GUIDELINES[guideline].margins

  // 1) Rewrite existing <w:pgMar .../> tags.
  let xml = documentXml.replace(/<w:pgMar\b[^>]*\/>/g, tag => {
    let t = tag
    t = setAttr(t, 'w:top', top)
    t = setAttr(t, 'w:right', right)
    t = setAttr(t, 'w:bottom', bottom)
    t = setAttr(t, 'w:left', left)
    return t
  })

  // 2) Insert a pgMar into any <w:sectPr> that lacks one.
  const pgMar = `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="708" w:footer="708" w:gutter="0"/>`
  xml = xml.replace(/<w:sectPr\b[^>]*>([\s\S]*?)<\/w:sectPr>/g, (full, inner: string) => {
    if (inner.includes('<w:pgMar')) return full
    return full.replace('</w:sectPr>', pgMar + '</w:sectPr>')
  })

  return xml
}
