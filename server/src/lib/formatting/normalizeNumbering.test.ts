import { describe, it, expect } from 'vitest'
import { normalizeNumberingXml } from './normalizeNumbering'

const NUM = (body: string) =>
  '<?xml version="1.0"?>' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  body +
  '</w:numbering>'

const lvl = (ilvl: number, ind = '') =>
  `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
  (ind ? `<w:pPr>${ind}</w:pPr>` : '') +
  `</w:lvl>`

describe('normalizeNumberingXml', () => {
  it('replaces existing <w:ind> with compact values for each level', () => {
    const xml = NUM(
      lvl(0, '<w:ind w:left="720" w:hanging="360"/>') +
      lvl(1, '<w:ind w:left="1440" w:hanging="360"/>'),
    )
    const out = normalizeNumberingXml(xml)
    expect(out).toContain('<w:ind w:left="480" w:hanging="240"/>')   // level 0
    expect(out).toContain('<w:ind w:left="960" w:hanging="240"/>')   // level 1
    expect(out).not.toContain('w:left="720"')
    expect(out).not.toContain('w:left="1440"')
  })

  it('injects <w:ind> when <w:pPr> exists but has no <w:ind>', () => {
    const xml = NUM(`<w:lvl w:ilvl="0"><w:pPr><w:jc w:val="left"/></w:pPr></w:lvl>`)
    const out = normalizeNumberingXml(xml)
    expect(out).toContain('<w:ind w:left="480" w:hanging="240"/>')
  })

  it('adds <w:pPr><w:ind/></w:pPr> when the level has no pPr at all', () => {
    const xml = NUM(`<w:lvl w:ilvl="2"><w:start w:val="1"/></w:lvl>`)
    const out = normalizeNumberingXml(xml)
    expect(out).toContain('<w:pPr><w:ind w:left="1440" w:hanging="240"/></w:pPr>')
  })

  it('processes lvlOverride entries the same way as abstractNum levels', () => {
    const xml = NUM(
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/>` +
      `<w:lvlOverride w:ilvl="1"><w:lvl w:ilvl="1"><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl></w:lvlOverride>` +
      `</w:num>`,
    )
    const out = normalizeNumberingXml(xml)
    expect(out).toContain('<w:ind w:left="960" w:hanging="240"/>')
  })

  it('leaves numbering.xml unchanged when there are no <w:lvl> elements', () => {
    const xml = NUM('<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>')
    expect(normalizeNumberingXml(xml)).toBe(xml)
  })
})
