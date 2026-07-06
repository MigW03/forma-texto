import { describe, it, expect } from 'vitest'
import { escapeXml, stripInvalidXmlChars, decodeXmlEntities } from './xmlText'

const NUL = String.fromCharCode(0)
const NONCHARS = String.fromCharCode(0xfffe, 0xffff)

describe('stripInvalidXmlChars', () => {
  it('removes a NUL byte (the production corruption)', () => {
    expect(stripInvalidXmlChars(`${NUL}ABNT. `)).toBe('ABNT. ')
  })

  it('removes other C0 control chars and non-characters', () => {
    expect(stripInvalidXmlChars(`x${NONCHARS}y`)).toBe('xy')
  })

  it('keeps tab, newline and carriage return', () => {
    expect(stripInvalidXmlChars('a\tb\nc\rd')).toBe('a\tb\nc\rd')
  })

  it('keeps accented and astral characters', () => {
    expect(stripInvalidXmlChars('Referências ✂ 😀')).toBe('Referências ✂ 😀')
  })
})

describe('escapeXml', () => {
  it('strips illegal chars and escapes markup in one pass', () => {
    expect(escapeXml(`${NUL}A & B < C > D`)).toBe('A &amp; B &lt; C &gt; D')
  })

  it('produces XML-safe output even from poisoned model text', () => {
    const out = `<w:t xml:space="preserve">${escapeXml(`${NUL}ABNT NBR 6023`)}</w:t>`
    expect(out).not.toContain(NUL)
    expect(out).toBe('<w:t xml:space="preserve">ABNT NBR 6023</w:t>')
  })
})

describe('decodeXmlEntities', () => {
  it('decodes the standard named entities', () => {
    expect(decodeXmlEntities('A &amp; B &lt; C &gt; D &quot;E&quot; &apos;F&apos;')).toBe('A & B < C > D "E" \'F\'')
  })

  it('decodes numeric character references (decimal and hex)', () => {
    expect(decodeXmlEntities('&#65;&#x42;')).toBe('AB')
  })

  it('decodes &amp; last, so it never re-interprets an already-decoded &', () => {
    // "&amp;lt;" in the source represents the literal text "&lt;" (not "<").
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;')
  })

  it('round-trips with escapeXml for a literal ampersand', () => {
    // The bug this guards: blockText used to return raw "&amp;" for a literal "&",
    // and re-escaping that with escapeXml produced a visible "&amp;" in the output
    // (e.g. sumário TOC entries for "CESAR & LOIS" rendering as "CESAR &amp; LOIS").
    const decoded = decodeXmlEntities('CESAR &amp; LOIS')
    expect(decoded).toBe('CESAR & LOIS')
    expect(escapeXml(decoded)).toBe('CESAR &amp; LOIS')
  })
})
