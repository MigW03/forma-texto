import { describe, it, expect } from 'vitest'
import { paragraphText, canSpliceParagraph, spliceCorrectedText } from './runs'

const P = (inner: string) => `<w:p>${inner}</w:p>`
const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`
const BOLD = '<w:rPr><w:b/></w:rPr>'

describe('paragraphText', () => {
  it('concatenates run text across multiple runs', () => {
    const p = P(run('O termo ') + run('importante', BOLD) + run(' do texto.'))
    expect(paragraphText(p)).toBe('O termo importante do texto.')
  })

  it('decodes XML entities', () => {
    expect(paragraphText(P(run('a &amp; b &lt; c')))).toBe('a & b < c')
  })

  it('is empty for a self-closed paragraph', () => {
    expect(paragraphText('<w:p/>')).toBe('')
  })
})

describe('canSpliceParagraph', () => {
  it('accepts a plain paragraph', () => {
    expect(canSpliceParagraph(P(run('texto')))).toBe(true)
  })
  it('rejects hyperlinks and fields', () => {
    expect(canSpliceParagraph(P('<w:hyperlink r:id="rId5">' + run('link') + '</w:hyperlink>'))).toBe(false)
    expect(canSpliceParagraph(P('<w:fldSimple w:instr="PAGE">' + run('1') + '</w:fldSimple>'))).toBe(false)
  })
  it('rejects a self-closed paragraph', () => {
    expect(canSpliceParagraph('<w:p/>')).toBe(false)
  })
})

describe('spliceCorrectedText', () => {
  it('returns null when the text is unchanged', () => {
    const p = P(run('sem mudanças'))
    expect(spliceCorrectedText(p, 'sem mudanças')).toBeNull()
  })

  it('fixes a typo inside a single run, keeping the pPr', () => {
    const p = `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${run('O aluno fizeram a prova.')}</w:p>`
    const out = spliceCorrectedText(p, 'O aluno fez a prova.')!
    expect(out).toContain('<w:jc w:val="both"/>') // paragraph props preserved
    expect(paragraphText(out)).toBe('O aluno fez a prova.')
  })

  it('preserves a bold run when the edit is in a different run', () => {
    // Edit lands in the first run; the bold run must survive untouched.
    const p = P(run('O metodo ') + run('cientifico', BOLD) + run(' foi usado.'))
    const out = spliceCorrectedText(p, 'O método cientifico foi usado.')!
    expect(out).toContain(`${BOLD}<w:t xml:space="preserve">cientifico</w:t>`)
    expect(paragraphText(out)).toBe('O método cientifico foi usado.')
  })

  it('coalesces same-rPr runs so an edit straddling a spurious split still applies', () => {
    // Word split "seginte" across two identical-format runs; coalescing makes it one.
    const p = P(run('No dia seg') + run('inte.'))
    const out = spliceCorrectedText(p, 'No dia seguinte.')!
    expect(paragraphText(out)).toBe('No dia seguinte.')
  })

  it('bails (returns null) when an edit crosses a real formatting boundary', () => {
    // exact = "foobar" (plain "foo" + bold "bar"). Replacing "ob" -> "X" spans the
    // plain/bold boundary at offset 3, so the whole paragraph is left unchanged.
    const p = P(run('foo') + run('bar', BOLD))
    expect(spliceCorrectedText(p, 'foXar')).toBeNull()
  })

  it('preserves a non-text anchor (line break) in place', () => {
    const p = P(run('linha um') + '<w:r><w:br/></w:r>' + run('linha dois'))
    const out = spliceCorrectedText(p, 'linha um' + 'linha 2')
    // "dois" -> "2" is in the second text run; the <w:br/> anchor stays.
    expect(out).toContain('<w:r><w:br/></w:r>')
  })

  it('returns null for a paragraph with a hyperlink', () => {
    const p = P('<w:hyperlink r:id="rId5">' + run('site') + '</w:hyperlink>')
    expect(spliceCorrectedText(p, 'sítio')).toBeNull()
  })
})
