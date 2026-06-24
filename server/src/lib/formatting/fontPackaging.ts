import { strFromU8, strToU8 } from 'fflate'

/**
 * Font-packaging normalization — the parts of a .docx that decide the *rendered* font
 * but live outside styles.xml/document.xml, and which Step A's style rewrite does NOT
 * reach. Two leftovers from a source authored in a non-standard font (e.g. Montserrat)
 * survive otherwise and make consumers — Google Docs especially — render the wrong font
 * while the toolbar still shows the family we set:
 *
 *  1. The theme (`word/theme/themeN.xml`) still names the author's `majorFont`/`minorFont`
 *     (e.g. Cambria/Calibri). Google Docs resolves default + heading text against the theme,
 *     so it draws those instead of the explicit family — serif headings, wrong body, etc.
 *  2. Embedded font binaries (`word/fonts/*.ttf` + `fontTable.xml` `<w:embed*>` refs +
 *     `embedTrueTypeFonts` in settings) remain even though nothing references that family
 *     anymore (Step A forced one accepted, system-available family everywhere).
 *
 * Both are normalized to the single family Step A resolved.
 */

/** Replace the `<a:latin>` typeface inside both the major and minor font of a theme. */
export function rewriteThemeFonts(themeXml: string, fam: string): string {
  const setLatin = (block: string) =>
    block.replace(/(<a:latin\b[^>]*\btypeface=")[^"]*(")/, `$1${fam}$2`)
  return themeXml
    .replace(/<a:majorFont>[\s\S]*?<\/a:majorFont>/, m => setLatin(m))
    .replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, m => setLatin(m))
}

/**
 * Mutate the zip `files` map: point every theme's major/minor font at `fam`, drop the
 * embedded-font binaries + their `fontTable.xml` `<w:embed*>` references + the font rels,
 * and turn off `embedTrueTypeFonts`/`embedSystemFonts`/`saveSubsetFonts` in settings.
 * Safe because Step A standardized the whole document to one system-available family, so
 * the embedded fonts are now unreferenced.
 */
export function normalizeFontPackaging(files: Record<string, Uint8Array>, fam: string): void {
  // 1. Theme fonts (themeN.xml — usually just theme1.xml).
  for (const key of Object.keys(files)) {
    if (/^word\/theme\/theme\d+\.xml$/.test(key)) {
      files[key] = strToU8(rewriteThemeFonts(strFromU8(files[key]), fam))
    }
  }

  // 2. Strip the embed references from fontTable.xml (leaves the plain font declarations).
  const FONT_TABLE = 'word/fontTable.xml'
  if (files[FONT_TABLE]) {
    const xml = strFromU8(files[FONT_TABLE])
    if (/<w:embed/.test(xml)) {
      files[FONT_TABLE] = strToU8(xml.replace(/<w:embed(?:Regular|Bold|Italic|BoldItalic)\b[^>]*\/>/g, ''))
    }
  }

  // 3. Delete the embedded font binaries and their relationship part (now orphaned).
  for (const key of Object.keys(files)) {
    if (/^word\/fonts\//.test(key)) delete files[key]
  }
  delete files['word/_rels/fontTable.xml.rels']

  // 4. Disable font embedding in settings.
  const SETTINGS = 'word/settings.xml'
  if (files[SETTINGS]) {
    const s = strFromU8(files[SETTINGS])
      .replace(/<w:embedTrueTypeFonts\b[^>]*\/>/g, '')
      .replace(/<w:embedSystemFonts\b[^>]*\/>/g, '')
      .replace(/<w:saveSubsetFonts\b[^>]*\/>/g, '')
    files[SETTINGS] = strToU8(s)
  }
}
