import { describe, it, expect } from 'vitest'
import { rewriteMargins } from './rewriteMargins'

describe('rewriteMargins (ABNT 3/2/3/2 cm)', () => {
  it('rewrites existing pgMar values, preserving header/footer', () => {
    const doc =
      '<w:body><w:sectPr>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
      '</w:sectPr></w:body>'
    const out = rewriteMargins(doc, 'abnt')
    expect(out).toContain('w:top="1701"')
    expect(out).toContain('w:left="1701"')
    expect(out).toContain('w:right="1134"')
    expect(out).toContain('w:bottom="1134"')
    expect(out).toContain('w:header="708"') // preserved
    expect(out).toContain('w:gutter="0"') // preserved
  })

  it('inserts pgMar into a sectPr that has none', () => {
    const doc = '<w:body><w:sectPr><w:cols w:space="708"/></w:sectPr></w:body>'
    const out = rewriteMargins(doc, 'abnt')
    expect(out).toContain('<w:pgMar')
    expect(out).toContain('w:top="1701"')
    expect(out).toContain('<w:cols w:space="708"/>') // existing content kept
  })

  it('handles multiple sectPr (section-level + body-level)', () => {
    const doc =
      '<w:p><w:pPr><w:sectPr><w:pgMar w:top="100" w:right="100" w:bottom="100" w:left="100"/></w:sectPr></w:pPr></w:p>' +
      '<w:sectPr><w:pgMar w:top="200" w:right="200" w:bottom="200" w:left="200"/></w:sectPr>'
    const out = rewriteMargins(doc, 'abnt')
    expect(out).not.toContain('w:top="100"')
    expect(out).not.toContain('w:top="200"')
    expect(out.match(/w:top="1701"/g)?.length).toBe(2)
  })
})
