import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { loadGuidelineFromSpec, listGuidelines } from './loadGuideline'
import { getGuideline, type Guideline } from './guidelines'

const SPEC_DIR = path.join(__dirname, 'specs')

/** Every guideline that ships a spec `.md` must parse and validate. */
const specFiles = fs
  .readdirSync(SPEC_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => path.basename(f, '.md') as Guideline)

describe('guideline specs', () => {
  it('finds at least the abnt spec', () => {
    expect(specFiles).toContain('abnt')
  })

  for (const id of specFiles) {
    describe(`${id}.md`, () => {
      it('parses + validates (catches a malformed edit before it hits a job)', () => {
        expect(() => loadGuidelineFromSpec(id)).not.toThrow()
      })

      it('uses exactly one font across body and headings (§2)', () => {
        const g = loadGuidelineFromSpec(id)
        expect(g.heading.font).toBe(g.body.font)
      })
    })
  }
})

describe('abnt spec values', () => {
  const g = loadGuidelineFromSpec('abnt')

  it('maps the §8 machine block to the pipeline shape', () => {
    expect(g).toEqual({
      body: { font: 'Times New Roman', sz: 24, line: 360, firstLine: 709, align: 'both' },
      heading: {
        font: 'Times New Roman',
        sz: 24,
        levels: { 1: { bold: true, case: 'upper' }, 2: { bold: false, case: 'upper' }, 3: { bold: true, case: 'sentence' } },
      },
      margins: { top: 1701, bottom: 1134, left: 1701, right: 1134 },
      references: { entryAlign: 'left', entryLine: 240, entryAfter: 240, hangingIndent: 0 },
    })
  })

  it('is reached through getGuideline() (spec wins over fallback)', () => {
    expect(getGuideline('abnt')).toEqual(g)
  })
})

describe('listGuidelines (dropdown source)', () => {
  const list = listGuidelines()

  it('returns one entry per spec file, abnt included', () => {
    expect(list.map(g => g.id)).toEqual(specFiles)
    expect(list.find(g => g.id === 'abnt')).toBeDefined()
  })

  it('each entry has a universal name and at least an en description', () => {
    for (const g of list) {
      expect(g.name).toBeTruthy()
      expect(g.description.en).toBeTruthy()
    }
  })

  it('abnt localizes its description', () => {
    const abnt = list.find(g => g.id === 'abnt')!
    expect(abnt.name).toBe('ABNT NBR 14724')
    expect(abnt.description['pt-BR']).toBe('Padrão acadêmico brasileiro')
    expect(abnt.description['pt-PT']).toBe('Padrão académico brasileiro')
  })
})

describe('getGuideline fallback', () => {
  it('returns built-in values for guidelines without a spec file', () => {
    // apa has no spec .md yet → fallback table is used, but still valid.
    const apa = getGuideline('apa')
    expect(apa.body.font).toBeTruthy()
    expect(apa.margins.top).toBeGreaterThan(0)
  })
})
