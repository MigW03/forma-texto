import { describe, it, expect } from 'vitest'
import { resolveDocumentFont } from './fontPolicy'

const ACCEPTED = ['Times New Roman', 'Arial']
const FALLBACK = 'Times New Roman'

const run = (font: string) => `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr><w:t>x</w:t></w:r>`
const doc = (...fonts: string[]) => `<w:document><w:body>${fonts.map(run).join('')}</w:body></w:document>`

describe('resolveDocumentFont', () => {
  it('keeps the source family when it is accepted (Arial body → Arial)', () => {
    expect(resolveDocumentFont(doc('Arial', 'Arial', 'Arial'), null, ACCEPTED, FALLBACK)).toBe('Arial')
  })

  it('falls back to the guideline default when the source font is not accepted', () => {
    expect(resolveDocumentFont(doc('Calibri', 'Calibri'), null, ACCEPTED, FALLBACK)).toBe('Times New Roman')
  })

  it('picks the dominant accepted family when the source mixes families', () => {
    expect(resolveDocumentFont(doc('Arial', 'Arial', 'Times New Roman'), null, ACCEPTED, FALLBACK)).toBe('Arial')
  })

  it('also considers fonts declared in styles.xml', () => {
    const styles = '<w:styles><w:style w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Arial"/></w:rPr></w:style></w:styles>'
    expect(resolveDocumentFont(doc(), styles, ACCEPTED, FALLBACK)).toBe('Arial')
  })

  it('falls back when the document declares no fonts at all', () => {
    expect(resolveDocumentFont(doc(), null, ACCEPTED, FALLBACK)).toBe('Times New Roman')
  })

  it('honours an explicit accepted choice over the source font', () => {
    expect(resolveDocumentFont(doc('Arial', 'Arial'), null, ACCEPTED, FALLBACK, 'Times New Roman')).toBe('Times New Roman')
  })

  it('ignores an explicit choice that is not an accepted family', () => {
    expect(resolveDocumentFont(doc('Arial'), null, ACCEPTED, FALLBACK, 'Comic Sans MS')).toBe('Arial')
  })
})
