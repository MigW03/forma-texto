import { describe, it, expect } from 'vitest'
import { strToU8, strFromU8 } from 'fflate'
import { rewriteThemeFonts, normalizeFontPackaging } from './fontPackaging'

const THEME = `<a:theme><a:themeElements><a:fontScheme name="Office">` +
  `<a:majorFont><a:latin typeface="Cambria" panose="02040503"/><a:ea typeface=""/><a:cs typeface=""/>` +
  `<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Calibri" panose="020F0502"/><a:ea typeface=""/><a:cs typeface=""/>` +
  `<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/></a:minorFont>` +
  `</a:fontScheme></a:themeElements></a:theme>`

describe('rewriteThemeFonts', () => {
  it('repoints the major and minor latin typeface to the chosen family', () => {
    const out = rewriteThemeFonts(THEME, 'Arial')
    expect(out).toContain('<a:majorFont><a:latin typeface="Arial"')
    expect(out).toContain('<a:minorFont><a:latin typeface="Arial"')
    expect(out).not.toContain('Cambria')
    expect(out).not.toContain('Calibri')
  })

  it('leaves script-specific <a:font> fallbacks untouched', () => {
    const out = rewriteThemeFonts(THEME, 'Arial')
    expect(out).toContain('<a:font script="Jpan" typeface="ＭＳ Ｐゴシック"/>')
  })
})

describe('normalizeFontPackaging', () => {
  const buildFiles = (): Record<string, Uint8Array> => ({
    'word/theme/theme1.xml': strToU8(THEME),
    'word/fontTable.xml': strToU8(
      `<w:fonts><w:font w:name="Arial"/>` +
        `<w:font w:name="Montserrat"><w:embedRegular r:id="rId1"/><w:embedBold r:id="rId2"/></w:font></w:fonts>`,
    ),
    'word/_rels/fontTable.xml.rels': strToU8('<Relationships/>'),
    'word/fonts/Montserrat-regular.ttf': new Uint8Array([1, 2, 3]),
    'word/fonts/Montserrat-bold.ttf': new Uint8Array([4, 5, 6]),
    'word/settings.xml': strToU8('<w:settings><w:embedTrueTypeFonts w:val="1"/><w:zoom/></w:settings>'),
  })

  it('rewrites the theme, strips embeds, deletes font binaries + rels, disables embedding', () => {
    const files = buildFiles()
    normalizeFontPackaging(files, 'Arial')

    expect(strFromU8(files['word/theme/theme1.xml'])).toContain('<a:minorFont><a:latin typeface="Arial"')
    const fontTable = strFromU8(files['word/fontTable.xml'])
    expect(fontTable).not.toContain('w:embed')
    expect(fontTable).toContain('<w:font w:name="Montserrat">') // declaration kept, embeds gone
    expect(files['word/fonts/Montserrat-regular.ttf']).toBeUndefined()
    expect(files['word/fonts/Montserrat-bold.ttf']).toBeUndefined()
    expect(files['word/_rels/fontTable.xml.rels']).toBeUndefined()
    expect(strFromU8(files['word/settings.xml'])).not.toContain('embedTrueTypeFonts')
    expect(strFromU8(files['word/settings.xml'])).toContain('<w:zoom/>') // other settings intact
  })
})
