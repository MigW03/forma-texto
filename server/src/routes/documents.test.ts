import { describe, it, expect } from 'vitest'
import { filenameFromDisposition } from './documents'

const FALLBACK = 'document_abc.docx'

describe('filenameFromDisposition', () => {
  it('prefers the RFC 5987 filename* (UTF-8) over the accent-stripped plain filename', () => {
    // Google sends both; the plain one has lost the accent, the starred one keeps it.
    const d = `attachment; filename="Titulo.docx"; filename*=UTF-8''T%C3%ADtulo.docx`
    expect(filenameFromDisposition(d, FALLBACK)).toBe('Título.docx')
  })

  it('decodes a multi-accent title fully (no truncation at the accent)', () => {
    const d = `attachment; filename="Avaliacao.docx"; filename*=UTF-8''Avalia%C3%A7%C3%A3o%20da%20escola.docx`
    expect(filenameFromDisposition(d, FALLBACK)).toBe('Avaliação da escola.docx')
  })

  it('falls back to the plain filename when there is no filename*', () => {
    expect(filenameFromDisposition('attachment; filename="Plain Name.docx"', FALLBACK)).toBe('Plain Name.docx')
  })

  it('always ends in .docx (adds the extension when missing)', () => {
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''Relat%C3%B3rio`, FALLBACK)).toBe('Relatório.docx')
  })

  it('returns the fallback when the header is missing or has no filename', () => {
    expect(filenameFromDisposition(null, FALLBACK)).toBe(FALLBACK)
    expect(filenameFromDisposition('attachment', FALLBACK)).toBe(FALLBACK)
  })

  it('keeps the raw value when it is not valid percent-encoding', () => {
    // A stray % that isn't an escape must not throw — keep the literal text.
    expect(filenameFromDisposition(`attachment; filename*=UTF-8''100%25.docx`, FALLBACK)).toBe('100%.docx')
    expect(filenameFromDisposition(`attachment; filename="bad%zz.docx"`, FALLBACK)).toBe('bad%zz.docx')
  })
})
