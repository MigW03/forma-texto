import { strFromU8, strToU8 } from 'fflate'
import { getBlocks, isParagraph, replaceBlocks } from './blocks'

/**
 * ABNT NBR 14724 page-number display convention (server side).
 *
 * Per NBR 14724, every sheet from the folha de rosto onward is COUNTED toward the
 * document's total page count, but the PRINTED page number stays hidden through the
 * entire pré-textual region — it only becomes visible starting on the first page of
 * the textual part (the "Introdução"), continuing the running count (the capa itself
 * is external to the count entirely, so the first visible number already accounts
 * for it having been skipped).
 *
 * Implemented as a real OOXML section split at `bodyStart` — the approach the removed
 * `<w:titlePg/>`-only `suppressCoverPageNumber` could not achieve (titlePg only ever
 * blanks a section's own FIRST page, so folha de rosto / resumo / sumário kept showing
 * a number):
 *  - **Front section** `[0, bodyStart)` — references an EMPTY header AND footer, so no
 *    page number prints on ANY of its pages, however many it spans. Crucially this is
 *    an EXPLICIT empty reference, not merely an absent one: a real upload almost always
 *    already carries its own document-wide header with a `PAGE` field (inherited from
 *    the template / Google-Docs export — the very case `suppressCoverPageNumber`
 *    existed for), and only an explicit empty reference reliably overrides it on the
 *    pré-textual pages across LibreOffice/Word.
 *  - **Body section** `[bodyStart, end)` — the document's own final `<w:sectPr>`, with
 *    ITS existing header/footer references stripped and replaced by a clean number-only
 *    header (right-aligned `PAGE` field), plus an explicit `<w:pgNumType w:start="…">`.
 *    The existing sectPr's other children (`cols`, `docGrid`, page geometry…) are
 *    PRESERVED — only header/footer/pgNumType/titlePg are touched — so a real document's
 *    column/grid layout survives.
 *
 * DOCX carries no page metadata, so the correct `start` value (folha de rosto = 1,
 * capa excluded) isn't knowable until the document is actually rendered. This pass
 * stamps a placeholder (`1`); `stampAbntPageNumberStart` (in `sumarioPagination.ts`,
 * alongside the sumário's own page-number stamping — same render, same page-text
 * match) overwrites it with the real value as the pipeline's final render pass.
 */

const TWIPS_2CM = 1134
/** ABNT §2 font size for page numbers (10pt = 20 half-points), matching `abnt.md`. */
const PAGE_NUMBER_HALF_POINTS = 20
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

type PartKind = 'header' | 'footer'

const PART_META: Record<PartKind, { tag: string; ct: string; relType: string }> = {
  header: {
    tag: 'hdr',
    ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
    relType: `${R_NS.replace(/relationships$/, '')}relationships/header`,
  },
  footer: {
    tag: 'ftr',
    ct: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml',
    relType: `${R_NS.replace(/relationships$/, '')}relationships/footer`,
  },
}

/** The document's own final `<w:sectPr>` (governs the body/last section), or null. */
function findFinalSectPr(documentXml: string): string | null {
  return documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/)?.[0] ?? null
}

/** Next free numeric suffix for `word/{kind}{N}.xml` in the zip. */
function nextPartIndex(files: Record<string, Uint8Array>, kind: PartKind): number {
  const re = new RegExp(`^word/${kind}(\\d+)\\.xml$`)
  let max = 0
  for (const key of Object.keys(files)) {
    const m = key.match(re)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max + 1
}

/** Next free numeric `rId` in a `.rels` part's XML. */
function nextRelId(relsXml: string): string {
  let max = 0
  for (const m of relsXml.matchAll(/Id="rId(\d+)"/g)) max = Math.max(max, parseInt(m[1], 10))
  return `rId${max + 1}`
}

/** ABNT-styled run properties (body font, 10pt, no bold/italic) for the number field. */
function numberRPr(font: string): string {
  return `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>` +
    `<w:sz w:val="${PAGE_NUMBER_HALF_POINTS}"/><w:szCs w:val="${PAGE_NUMBER_HALF_POINTS}"/></w:rPr>`
}

/** A `<w:hdr>` with a single right-aligned `PAGE` field, ABNT-styled. */
function buildNumberHeaderXml(font: string): string {
  const rPr = numberRPr(font)
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:p><w:pPr><w:jc w:val="right"/>${numberRPr(font)}</w:pPr>` +
    `<w:r>${rPr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${rPr}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
    `<w:r>${rPr}<w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r>${rPr}<w:t>1</w:t></w:r>` +
    `<w:r>${rPr}<w:fldChar w:fldCharType="end"/></w:r></w:p>` +
    '</w:hdr>'
  )
}

/** An empty header/footer part — one blank paragraph, renders nothing. */
function buildEmptyPartXml(kind: PartKind): string {
  const tag = PART_META[kind].tag
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:${tag}>`
  )
}

/**
 * Register a header/footer part in the zip (the part, its Content_Types override, and
 * a document relationship) and return the new relationship id to reference it by.
 */
function registerPart(files: Record<string, Uint8Array>, kind: PartKind, xml: string): string {
  const meta = PART_META[kind]
  const idx = nextPartIndex(files, kind)
  const partPath = `word/${kind}${idx}.xml`
  files[partPath] = strToU8(xml)

  const ctPath = '[Content_Types].xml'
  const ct = strFromU8(files[ctPath])
  const override = `<Override PartName="/${partPath}" ContentType="${meta.ct}"/>`
  files[ctPath] = strToU8(ct.includes(override) ? ct : ct.replace('</Types>', `${override}</Types>`))

  const relsPath = 'word/_rels/document.xml.rels'
  const rels = strFromU8(files[relsPath])
  const rid = nextRelId(rels)
  const rel = `<Relationship Id="${rid}" Type="${meta.relType}" Target="${kind}${idx}.xml"/>`
  files[relsPath] = strToU8(rels.replace('</Relationships>', `${rel}</Relationships>`))

  return rid
}

/**
 * Every prior pass in this pipeline only ever READ an existing `r:id`/`r:embed`
 * attribute (on content the author's own document already carried, e.g. images or
 * hyperlinks) — the `xmlns:r` declaration those need was always already there because
 * it came with them. `<w:headerReference r:id="…">` is the first thing this pipeline
 * itself ADDS that needs the `r:` prefix, so it can't assume the declaration exists:
 * even this project's own minimal test fixture only declares `xmlns:w` on the root
 * `<w:document>`. Injects `xmlns:r` into that root tag when missing; a no-op otherwise.
 */
function ensureRNamespace(documentXml: string): string {
  const m = documentXml.match(/<w:document\b[^>]*>/)
  if (!m || /\bxmlns:r=/.test(m[0])) return documentXml
  const withNs = m[0].replace(/^<w:document\b/, `<w:document xmlns:r="${R_NS}"`)
  return documentXml.replace(m[0], withNs)
}

/** A paragraph's own `<w:pPr>`, or '' when it has none. */
function pPrOf(block: string): string {
  return block.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)?.[0] ?? block.match(/<w:pPr\b[^>]*\/>/)?.[0] ?? ''
}

/** Insert `xml` as the last child of a paragraph's `<w:pPr>`, creating one if absent. */
function appendToPPr(block: string, xml: string): string {
  if (/<w:pPr\b[^>]*>/.test(block)) return block.replace(/<\/w:pPr>/, `${xml}</w:pPr>`)
  if (/<w:pPr\b[^>]*\/>/.test(block)) return block.replace(/<w:pPr\b[^>]*\/>/, `<w:pPr>${xml}</w:pPr>`)
  return block.replace(/(<w:p\b[^>]*>)/, `$1<w:pPr>${xml}</w:pPr>`)
}

/**
 * Split the document into a hidden pré-textual section and a numbered body section at
 * `bodyStart`, per NBR 14724. No-op when there is no pré-textual region (`bodyStart ===
 * 0`), when the document has no final `<w:sectPr>` to clone geometry from, or when a
 * section break already sits at the boundary (idempotent / an author who already split
 * there).
 */
export function applyAbntPageNumbering(
  documentXml: string,
  files: Record<string, Uint8Array>,
  bodyStart: number,
  font: string,
): string {
  if (bodyStart <= 0) return documentXml

  const finalSectPr = findFinalSectPr(documentXml)
  if (!finalSectPr) return documentXml

  const pgSz = finalSectPr.match(/<w:pgSz\b[^>]*\/>/)?.[0]
  const pgMar = finalSectPr.match(/<w:pgMar\b[^>]*\/>/)?.[0]
  if (!pgSz || !pgMar) return documentXml

  const blocks = getBlocks(documentXml)
  const lastPretextualIdx = bodyStart - 1
  if (lastPretextualIdx < 0 || lastPretextualIdx >= blocks.length) return documentXml
  // Idempotency / respect an author's own break: if the boundary block already ends a
  // section, don't add a second one. (A pre-existing header on the FINAL sectPr is NOT
  // a signal we already ran — real uploads ship with one; that's the whole point.)
  if (isParagraph(blocks[lastPretextualIdx]) && /<w:sectPr\b/.test(pPrOf(blocks[lastPretextualIdx]))) {
    return documentXml
  }

  // Register the three parts up front (mutates `files`): a clean number-only header for
  // the body, and empty header + footer for the pré-textual front section.
  const numHdrRid = registerPart(files, 'header', buildNumberHeaderXml(font))
  const emptyHdrRid = registerPart(files, 'header', buildEmptyPartXml('header'))
  const emptyFtrRid = registerPart(files, 'footer', buildEmptyPartXml('footer'))

  // Body section: MODIFY the existing final sectPr in place (preserving cols/docGrid/…)
  // rather than rebuilding it — strip whatever header/footer/titlePg/pgNumType it
  // carried (the inherited always-on PAGE header lives here), then inject our own.
  let bodySectPr = finalSectPr
    .replace(/<w:headerReference\b[^>]*\/>/g, '')
    .replace(/<w:footerReference\b[^>]*\/>/g, '')
    .replace(/<w:titlePg\b[^>]*\/>/g, '')
    .replace(/<w:pgNumType\b[^>]*\/>/g, '')
  // 2cm header distance (ABNT: the number sits 2cm from the top edge).
  const pgMarWithHeaderDist = pgMar.includes('w:header=')
    ? pgMar.replace(/w:header="\d+"/, `w:header="${TWIPS_2CM}"`)
    : pgMar.replace(/\/>$/, ` w:header="${TWIPS_2CM}"/>`)
  // pgNumType (CT_SectPr order slot 10) goes right after pgMar (slot 6); header
  // reference (slot 1) goes right after the opening tag.
  bodySectPr = bodySectPr
    .replace(pgMar, `${pgMarWithHeaderDist}<w:pgNumType w:fmt="decimal" w:start="1"/>`)
    .replace(/(<w:sectPr\b[^>]*>)/, `$1<w:headerReference w:type="default" r:id="${numHdrRid}"/>`)
  let out = ensureRNamespace(documentXml).replace(finalSectPr, bodySectPr)

  // Front section: page geometry + EXPLICIT empty header & footer references, so no
  // number prints on any pré-textual page even when the source document applied a
  // document-wide header/footer. Stamped onto the LAST pré-textual block; the
  // body-level sectPr isn't a `getBlocks` block, so this doesn't disturb the swap above.
  const frontSectPr =
    `<w:sectPr><w:headerReference w:type="default" r:id="${emptyHdrRid}"/>` +
    `<w:footerReference w:type="default" r:id="${emptyFtrRid}"/>${pgSz}${pgMar}</w:sectPr>`
  const byIndex = new Map<number, string>()
  const target = blocks[lastPretextualIdx]
  if (isParagraph(target)) {
    byIndex.set(lastPretextualIdx, appendToPPr(target, frontSectPr))
  } else {
    // The last pré-textual block isn't a plain paragraph (e.g. the collapsed cover
    // table). A section break can only live in a paragraph's pPr, so append a new one.
    byIndex.set(lastPretextualIdx, target + `<w:p><w:pPr>${frontSectPr}</w:pPr></w:p>`)
  }
  out = replaceBlocks(out, byIndex)

  return out
}
