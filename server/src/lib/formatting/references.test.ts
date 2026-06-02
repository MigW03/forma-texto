import { describe, it, expect } from 'vitest'
import { formatReferences } from './references'
import { rewriteStyles } from './rewriteStyles'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const pageBreak = () => '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:pPr></w:p>'
const doc = (...blocks: string[]) => `<w:document xmlns:w="${W}"><w:body>${blocks.join('')}</w:body></w:document>`

// 3 sectPr-delimited pages:
//  page 1: intro + a BODY mention of "referências" (must NOT be touched)
//  page 2: "Referências" heading + an entry
//  page 3: another entry
const sample = () => doc(
  p('Introdução do trabalho.'),
  p('Este trabalho cita várias referências ao longo do texto.'), // body trap
  pageBreak(),                                                    // end page 1
  p('Referências'),                                               // page 2 heading
  p('Gil, Antônio Carlos. Como elaborar projetos de pesquisa. São Paulo: Atlas, 2017.'),
  pageBreak(),                                                    // end page 2
  p('Santos, Maria. Métodos de pesquisa. São Paulo: Cortez, 2019.'), // page 3
)

describe('formatReferences — bounded to user-flagged pages (ABNT)', () => {
  it('formats only the flagged pages (2,3); leaves the page-1 body mention untouched', () => {
    const out = formatReferences(sample(), 'abnt', { selectedPages: [1, 2, 3], referencePages: [2, 3] })

    // page-1 body paragraph that mentions "referências" is unchanged — no heading style, no forced left jc
    const page1Para = out.match(/<w:p>(?:(?!<\/w:p>).)*cita várias referências[\s\S]*?<\/w:p>/)![0]
    expect(page1Para).not.toContain('ReferencesHeading')
    expect(page1Para).not.toContain('<w:jc')

    // the heading on page 2 gets the references-heading style
    const headingPara = out.match(/<w:p>(?:(?!<\/w:p>).)*>Referências<[\s\S]*?<\/w:p>/)![0]
    expect(headingPara).toContain('<w:pStyle w:val="ReferencesHeading"/>')

    // entries on pages 2 & 3 get left alignment + single spacing, no hanging indent
    expect(out).toContain('<w:jc w:val="left"/>')
    expect(out).toContain('w:line="240"')
    expect(out).not.toContain('w:hanging=')
  })

  it('does nothing when no pages are flagged', () => {
    const xml = sample()
    expect(formatReferences(xml, 'abnt', { selectedPages: [1, 2, 3], referencePages: [] })).toBe(xml)
  })

  it('does nothing without page metadata', () => {
    const xml = sample()
    expect(formatReferences(xml, 'abnt', { selectedPages: [], referencePages: [2, 3] })).toBe(xml)
  })
})

// Real-world pagination: manual <w:br w:type="page"/> at the START of a paragraph
// (break-before), as produced by Word/Google-Docs exports without per-page sectPr.
const breakBeforeSample = () => {
  const pBreak = (text: string) =>
    `<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
  return doc(
    p('Introdução do trabalho.'),
    p('O texto cita várias referências no corpo.'), // page-1 body trap
    pBreak('Referências'),                          // page 2 starts here
    p('Gil, Antônio Carlos. Como elaborar projetos de pesquisa. São Paulo: Atlas, 2017.'),
    pBreak('Mais referências.'),                    // page 3 starts here
  )
}

describe('formatReferences — manual page-break pagination (break-before)', () => {
  it('maps flagged pages via <w:br type=page> and skips the page-1 body mention', () => {
    const out = formatReferences(breakBeforeSample(), 'abnt', { selectedPages: [1, 2, 3], referencePages: [2, 3] })
    // page-1 body mention untouched
    const page1Para = out.match(/<w:p>(?:(?!<\/w:p>).)*cita várias referências[\s\S]*?<\/w:p>/)![0]
    expect(page1Para).not.toContain('<w:jc')
    expect(page1Para).not.toContain('ReferencesHeading')
    // first paragraph of page 2 (the heading) styled
    const headingPara = out.match(/<w:p>(?:(?!<\/w:p>).)*>Referências<[\s\S]*?<\/w:p>/)![0]
    expect(headingPara).toContain('<w:pStyle w:val="ReferencesHeading"/>')
    expect(out).toContain('<w:jc w:val="left"/>')
  })
})

describe('formatReferences (APA) — hanging indent on flagged pages', () => {
  it('applies 0.5in hanging indent and double spacing to entries', () => {
    const out = formatReferences(sample(), 'apa', { selectedPages: [1, 2, 3], referencePages: [2, 3] })
    expect(out).toContain('<w:ind w:left="720" w:hanging="720"/>')
    expect(out).toContain('w:line="480"')
  })
})

describe('references heading style is registered by rewriteStyles', () => {
  it('defines ReferencesHeading (centered, bold, caps)', () => {
    const styles = rewriteStyles(null, 'abnt')
    const block = styles.match(/<w:style[^>]*w:styleId="ReferencesHeading"[\s\S]*?<\/w:style>/)![0]
    expect(block).toContain('<w:jc w:val="center"/>')
    expect(block).toContain('<w:b/>')
    expect(block).toContain('<w:caps/>')
  })
})
