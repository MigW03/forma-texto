import { describe, it, expect } from 'vitest'
import { applyPunctNorm, applyPunctNormWithStats } from './applyPunctNorm'

// Minimal helpers to build document XML fragments for tests
const wt = (text: string, space = false) =>
  `<w:t${space ? ' xml:space="preserve"' : ''}>${text}</w:t>`

const wr = (text: string, space = false) => `<w:r>${wt(text, space)}</w:r>`

const wp = (...runs: string[]) => `<w:p>${runs.join('')}</w:p>`

const doc = (...paras: string[]) =>
  `<?xml version="1.0"?><w:document><w:body>${paras.join('')}</w:body></w:document>`

describe('applyPunctNorm — pass 1: intra-run normalization', () => {
  it('collapses double spaces', () => {
    const input = doc(wp(wr('Hello  world')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('Hello world'))
  })

  it('collapses three or more spaces', () => {
    const input = doc(wp(wr('a   b    c')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('a b c'))
  })

  it('removes space before period', () => {
    const input = doc(wp(wr('Hello .')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('Hello.'))
  })

  it('removes space before comma', () => {
    const input = doc(wp(wr('foo , bar')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('foo, bar'))
  })

  it('removes space before semicolon', () => {
    const input = doc(wp(wr('item1 ; item2')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('item1; item2'))
  })

  it('removes space before colon', () => {
    const input = doc(wp(wr('Resultado : 10')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('Resultado: 10'))
  })

  it('removes space before exclamation mark', () => {
    const input = doc(wp(wr('Atenção !')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('Atenção!'))
  })

  it('removes space before question mark', () => {
    const input = doc(wp(wr('Como assim ?')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('Como assim?'))
  })

  it('normalizes three-dot ellipsis to unicode', () => {
    const input = doc(wp(wr('continuou...')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('continuou…'))
  })

  it('does not collapse four-dot ellipsis (intentional)', () => {
    const input = doc(wp(wr('fim....')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('fim....'))
  })

  it('preserves existing unicode ellipsis unchanged', () => {
    const input = doc(wp(wr('já tem… assim')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('já tem… assim'))
  })

  it('leaves XML attributes on <w:t> intact', () => {
    const input = doc(wp(`<w:r><w:t xml:space="preserve">Hello  world .</w:t></w:r>`))
    const output = applyPunctNorm(input)
    expect(output).toContain(`xml:space="preserve"`)
    expect(output).toContain('>Hello world.<')
  })

  it('does not touch text in non-paragraph blocks (tables passthrough)', () => {
    // Tables are left unchanged by pass 2 but pass 1 still normalises their runs
    const input = doc(`<w:tbl><w:tr><w:tc><w:p>${wr('cell  value')}</w:p></w:tc></w:tr></w:tbl>`)
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('cell value'))
  })

  it('does not remove space before period inside a number (e.g. decimal)', () => {
    // "1.000" — the space is before the thousands separator; this test checks
    // that "R$ 1.000,00" stays intact (no space before the period there anyway)
    const input = doc(wp(wr('R$ 1.000,00')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('R$ 1.000,00'))
  })

  it('handles multiple violations in one run', () => {
    const input = doc(wp(wr('foo  bar ,  baz ...')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('foo bar, baz…'))
  })

  it('leaves an empty <w:t> unchanged', () => {
    const input = doc(wp(`<w:r><w:t></w:t></w:r>`))
    const output = applyPunctNorm(input)
    expect(output).toContain(`<w:t></w:t>`)
  })
})

describe('applyPunctNorm — pass 1: missing space AFTER punctuation', () => {
  it('inserts a space after a period before an uppercase letter', () => {
    const input = doc(wp(wr('Fim da frase.Início da próxima')))
    const output = applyPunctNorm(input)
    expect(output).toContain(wt('Fim da frase. Início da próxima'))
  })

  it('inserts a space after ! and ? before an uppercase letter', () => {
    expect(applyPunctNorm(doc(wp(wr('Atenção!Cuidado'))))).toContain(wt('Atenção! Cuidado'))
    expect(applyPunctNorm(doc(wp(wr('Sério?Não'))))).toContain(wt('Sério? Não'))
  })

  it('inserts a space after a comma/semicolon/colon before any letter', () => {
    expect(applyPunctNorm(doc(wp(wr('casa,carro'))))).toContain(wt('casa, carro'))
    expect(applyPunctNorm(doc(wp(wr('item1;item2'))))).toContain(wt('item1; item2'))
    expect(applyPunctNorm(doc(wp(wr('Nota:importante'))))).toContain(wt('Nota: importante'))
  })

  it('does NOT split a lowercase URL domain (period before lowercase)', () => {
    const input = doc(wp(wr('researchgate.net/publication')))
    expect(applyPunctNorm(input)).toContain(wt('researchgate.net/publication'))
  })

  it('does NOT split a thousands/decimal number (period before digit)', () => {
    expect(applyPunctNorm(doc(wp(wr('R$ 1.000,00'))))).toContain(wt('R$ 1.000,00'))
    expect(applyPunctNorm(doc(wp(wr('versão 3.14'))))).toContain(wt('versão 3.14'))
  })

  it('does NOT add a space inside a time or ratio (colon before digit)', () => {
    expect(applyPunctNorm(doc(wp(wr('às 10:30'))))).toContain(wt('às 10:30'))
    expect(applyPunctNorm(doc(wp(wr('proporção 2:1'))))).toContain(wt('proporção 2:1'))
  })

  it('leaves an abbreviation like p.ex. untouched (period before lowercase)', () => {
    expect(applyPunctNorm(doc(wp(wr('p.ex. isto'))))).toContain(wt('p.ex. isto'))
  })

  it('counts the after-space fixes in stats', () => {
    const { stats } = applyPunctNormWithStats(doc(wp(wr('Fim.Início e casa,carro'))))
    expect(stats.spaceAfterPunct).toBe(2)
  })

  it('is idempotent for the after-space rule', () => {
    const input = doc(wp(wr('Fim.Início')))
    const once = applyPunctNorm(input)
    expect(applyPunctNorm(once)).toBe(once)
  })
})

describe('applyPunctNorm — pass 1: smart (curly) quotes', () => {
  it('converts straight double quotes to opening/closing curly quotes', () => {
    const input = doc(wp(wr('Ele disse "olá" a todos')))
    expect(applyPunctNorm(input)).toContain(wt('Ele disse “olá” a todos'))
  })

  it('converts an apostrophe between letters to a curly apostrophe', () => {
    const input = doc(wp(wr("pingo d'água")))
    expect(applyPunctNorm(input)).toContain(wt('pingo d’água'))
  })

  it('does not touch quotes in <w:t> attributes (only text content)', () => {
    const input = doc(wp(`<w:r><w:t xml:space="preserve">"citação"</w:t></w:r>`))
    const output = applyPunctNorm(input)
    expect(output).toContain('xml:space="preserve"')
    expect(output).toContain('>“citação”<')
  })

  it('counts each converted quote', () => {
    const { stats } = applyPunctNormWithStats(doc(wp(wr('"a" "b"'))))
    expect(stats.smartQuotes).toBe(4)
  })
})

describe('applyPunctNorm — pass 1: em dash spacing', () => {
  it('converts a spaced hyphen between words to a spaced em dash', () => {
    expect(applyPunctNorm(doc(wp(wr('texto - mais texto'))))).toContain(wt('texto — mais texto'))
  })

  it('converts a spaced double hyphen to an em dash', () => {
    expect(applyPunctNorm(doc(wp(wr('texto -- texto'))))).toContain(wt('texto — texto'))
  })

  it('leaves a numeric range (digits both sides) as a hyphen', () => {
    expect(applyPunctNorm(doc(wp(wr('entre 2010 - 2020'))))).toContain(wt('entre 2010 - 2020'))
  })

  it('does not touch a hyphenated word (no surrounding spaces)', () => {
    expect(applyPunctNorm(doc(wp(wr('bem-vindo'))))).toContain(wt('bem-vindo'))
  })
})

describe('applyPunctNorm — pass 1: non-breaking space (number + unit)', () => {
  const NBSP = ' '

  it('inserts a non-breaking space between a number and a unit', () => {
    expect(applyPunctNorm(doc(wp(wr('cerca de 10 km')))))
      .toContain(wt(`cerca de 10${NBSP}km`))
  })

  it('handles a multi-letter unit (min) before a longer match (m)', () => {
    expect(applyPunctNorm(doc(wp(wr('durou 5 min')))))
      .toContain(wt(`durou 5${NBSP}min`))
  })

  it('does NOT treat an ordinary word as a unit', () => {
    expect(applyPunctNorm(doc(wp(wr('há 10 anos'))))).toContain(wt('há 10 anos'))
    expect(applyPunctNorm(doc(wp(wr('5 metros'))))).toContain(wt('5 metros'))
  })

  it('counts the non-breaking-space insertions', () => {
    const { stats } = applyPunctNormWithStats(doc(wp(wr('10 km e 5 kg'))))
    expect(stats.nbsp).toBe(2)
  })

  it('is idempotent for the unit rule', () => {
    const once = applyPunctNorm(doc(wp(wr('10 km'))))
    expect(applyPunctNorm(once)).toBe(once)
  })
})

describe('applyPunctNorm — pass 2: cross-run space-before-punctuation', () => {
  it('removes trailing space in first run when next run starts with period', () => {
    // "Hello " in run 1, "." in run 2 → "Hello" + "."
    const input = doc(wp(
      `<w:r><w:t xml:space="preserve">Hello </w:t></w:r>`,
      `<w:r><w:t>.</w:t></w:r>`,
    ))
    const output = applyPunctNorm(input)
    expect(output).toContain('>Hello<')
    expect(output).not.toContain('>Hello <')
  })

  it('removes trailing space before comma across runs', () => {
    const input = doc(wp(
      `<w:r><w:t xml:space="preserve">item </w:t></w:r>`,
      `<w:r><w:t>,</w:t></w:r>`,
    ))
    const output = applyPunctNorm(input)
    expect(output).toContain('>item<')
    expect(output).not.toContain('>item <')
  })

  it('leaves mid-sentence space intact when next run is not punctuation', () => {
    const input = doc(wp(
      `<w:r><w:t xml:space="preserve">Hello </w:t></w:r>`,
      `<w:r><w:t>world</w:t></w:r>`,
    ))
    const output = applyPunctNorm(input)
    expect(output).toContain('>Hello <')
  })

  it('handles run properties between the two runs', () => {
    // Real DOCX often has <w:rPr> inside the second run
    const input = doc(wp(
      `<w:r><w:t xml:space="preserve">texto </w:t></w:r>`,
      `<w:r><w:rPr><w:b/></w:rPr><w:t>.</w:t></w:r>`,
    ))
    const output = applyPunctNorm(input)
    expect(output).toContain('>texto<')
    expect(output).not.toContain('>texto <')
  })
})

describe('applyPunctNorm — document structure preserved', () => {
  it('does not alter XML outside <w:t> nodes', () => {
    const input = doc(wp(`<w:pPr><w:jc w:val="both"/></w:pPr>`, wr('Normal text.')))
    const output = applyPunctNorm(input)
    expect(output).toContain('<w:pPr><w:jc w:val="both"/></w:pPr>')
  })

  it('is idempotent — running twice yields the same result', () => {
    const input = doc(wp(wr('Hello  world ,  foo...')))
    const once = applyPunctNorm(input)
    const twice = applyPunctNorm(once)
    expect(twice).toBe(once)
  })
})
