import { describe, it, expect } from 'vitest'
import { escapeXml, stripInvalidXmlChars } from './xmlText'

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
