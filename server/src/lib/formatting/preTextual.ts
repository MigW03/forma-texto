import { getBlocks, isParagraph, isStructuredDocTag, blockText, setParagraphStyle, replaceBlocks } from './blocks'
import { REFERENCES_HEADING_STYLE, COVER_STYLE, FOLHA_ROSTO_NATUREZA_STYLE } from './guidelines'
import { escapeXml } from './xmlText'

/**
 * ABNT pré-textual element detection + formatting (server side).
 *
 * Pré-textuais are the front matter that precedes the body of an academic work:
 * capa, folha de rosto, folha de aprovação, dedicatória, agradecimentos, epígrafe,
 * errata, resumo, abstract, the listas, and the sumário. They are not body text and
 * must not be swept up by the body passes:
 *  - Step D must not promote a capa/resumo line to a numbered Heading1.
 *  - Each *labeled* section heading (RESUMO, SUMÁRIO, …) is an ABNT "título sem
 *    indicativo numérico" — centered, bold, UPPERCASE, unnumbered. That is exactly
 *    the references-heading style, so we reuse it (`REFERENCES_HEADING_STYLE`).
 *
 * This mirrors `web/src/lib/pretextual.ts` (which drives the page-selection UI and
 * lauda billing). The web detector runs on rendered text; this one runs on the
 * document XML blocks — same algorithm, same block indices the rest of the pipeline
 * uses. The capa↔folha split is heuristic; correct cover layout/generation needs the
 * detect-and-confirm field step and is intentionally out of scope here.
 */

export type PretextualKind =
  | 'capa'
  | 'folhaDeRosto'
  | 'folhaDeAprovacao'
  | 'dedicatoria'
  | 'agradecimentos'
  | 'epigrafe'
  | 'errata'
  | 'resumo'
  | 'abstract'
  | 'listaIlustracoes'
  | 'listaTabelas'
  | 'listaAbreviaturas'
  | 'sumario'

export interface PretextualSection {
  kind: PretextualKind
  /** First block index (inclusive, absolute). */
  blockStart: number
  /** Last block index (inclusive, absolute). */
  blockEnd: number
}

export interface PretextualResult {
  sections: PretextualSection[]
  /** First body block index; `[0, bodyStart)` is the pré-textual region. 0 = none. */
  bodyStart: number
}

/** Kinds that have a label heading paragraph at `blockStart` (everything but the covers). */
const LABELED_KINDS: ReadonlySet<PretextualKind> = new Set<PretextualKind>([
  'folhaDeAprovacao', 'dedicatoria', 'agradecimentos', 'epigrafe', 'errata',
  'resumo', 'abstract', 'listaIlustracoes', 'listaTabelas', 'listaAbreviaturas', 'sumario',
])

/**
 * The identity/cover pages: capa, folha de rosto, folha de aprovação. Their text is
 * institution names, author/examiner names, the title, and dates — proofreading would
 * "correct" proper nouns, so these blocks are excluded from Step P. (Resumo, abstract,
 * agradecimentos, … are NOT covers and are proofread normally.)
 */
const COVER_KINDS: ReadonlySet<PretextualKind> = new Set<PretextualKind>([
  'capa', 'folhaDeRosto', 'folhaDeAprovacao',
])

/** Sections whose every paragraph is centered as a cover page. */
const CENTER_KINDS: ReadonlySet<PretextualKind> = new Set<PretextualKind>(['capa'])

/** Block indices belonging to the cover/identity pages — pass to Step P as `excludeIndices`. */
export function coverBlockIndices(sections: PretextualSection[]): Set<number> {
  const out = new Set<number>()
  for (const s of sections) {
    if (!COVER_KINDS.has(s.kind)) continue
    for (let i = s.blockStart; i <= s.blockEnd; i++) out.add(i)
  }
  return out
}

const LABEL_MATCHERS: { kind: PretextualKind; re: RegExp }[] = [
  { kind: 'resumo', re: /^resumo$/i },
  { kind: 'abstract', re: /^(abstract|resumen)$/i },
  { kind: 'sumario', re: /^sum[áa]rio$/i },
  { kind: 'agradecimentos', re: /^agradecimentos?$/i },
  { kind: 'dedicatoria', re: /^dedicat[óo]ria$/i },
  { kind: 'epigrafe', re: /^ep[íi]grafe$/i },
  { kind: 'errata', re: /^errata$/i },
  { kind: 'folhaDeAprovacao', re: /^folha de aprova[çc][ãa]o$/i },
  { kind: 'listaIlustracoes', re: /^lista de (ilustra[çc][õo]es|figuras|gr[áa]ficos|quadros)$/i },
  { kind: 'listaTabelas', re: /^lista de tabelas$/i },
  { kind: 'listaAbreviaturas', re: /^lista de (abreviaturas|siglas|abreviaturas e siglas|s[íi]mbolos)$/i },
]

// Must be the actual folha-de-rosto presentation phrase — NOT bare thesis-type words
// (tese/dissertação/monografia), which appear in normal body prose and would falsely flag
// real chapters as front matter. Mirrors web/src/lib/pretextual.ts.
const NATUREZA_RE =
  /apresentad[oa]\s+(a|ao|à)\b|requisito\s+parcial|obten[çc][ãa]o\s+d[eo]\s+(t[íi]tulo|grau)|trabalho de conclus[ãa]o de curso/i
const ORIENTADOR_RE = /orientador(a)?\s*[:-]/i
const YEAR_LINE_RE = /^(19|20)\d{2}$/

function isTocEntry(text: string): boolean {
  if (!text) return false
  return /\.{2,}\s*\d{1,4}$/.test(text) || /\s\d{1,4}$/.test(text)
}

function isBodyHeading(text: string): boolean {
  if (!text || isTocEntry(text)) return false
  if (/^\d+(\.\d+)*\.?\s+\p{L}/u.test(text)) return true
  return false
}

/**
 * The bare word "Introdução" — matches whether or not the author (or Word's own
 * `<w:numPr>` multilevel-list numbering, which never shows up in `blockText`) has
 * numbered it yet. On its own this is ambiguous: the sumário lists the same bare word
 * as a TOC entry when the author hasn't paginated it (no trailing page number for
 * `isTocEntry` to key on) — see `looksLikeBodyProse` for the context check that tells
 * the two apart.
 */
function isIntroducaoWord(text: string): boolean {
  return /^introdu[çc][ãa]o$/i.test(text)
}

/**
 * Distinguishes the real "Introdução" heading from a same-text sumário TOC entry: a
 * real heading is immediately followed by an actual paragraph of body prose, while a
 * TOC entry is followed by nothing of the sort (another short chapter-name-style line,
 * or the section simply ends there). Prose is identified as long and/or ending in
 * sentence punctuation and — per ABNT chapter-title convention (ALL-CAPS) — not itself
 * a short all-caps line.
 */
function looksLikeBodyProse(text: string): boolean {
  if (!text) return false
  if (text.length > 60) return true
  if (/[.!?…]$/.test(text)) return true
  return text.length > 20 && text !== text.toUpperCase()
}

function matchLabel(text: string): PretextualKind | null {
  for (const { kind, re } of LABEL_MATCHERS) if (re.test(text)) return kind
  return null
}

/**
 * Classify a list of block texts into the pré-textual region. Kept separate from XML
 * parsing so it is trivially unit-testable. See `web/src/lib/pretextual.ts` for the
 * narrative of the algorithm — this is a faithful port.
 */
export function classifyPretextual(texts: string[]): PretextualResult {
  const trimmed = texts.map(t => t.trim())

  const labeled: { kind: PretextualKind; index: number }[] = []
  let lastSignal = -1
  let firstNatureza = -1
  for (let i = 0; i < trimmed.length; i++) {
    const t = trimmed[i]
    if (!t) continue
    const kind = matchLabel(t)
    if (kind) {
      labeled.push({ kind, index: i })
      lastSignal = i
      continue
    }
    if (NATUREZA_RE.test(t) || ORIENTADOR_RE.test(t)) {
      if (firstNatureza === -1) firstNatureza = i
      lastSignal = Math.max(lastSignal, i)
    }
  }

  const firstLabeled = labeled.length ? labeled[0].index : -1
  if (lastSignal === -1) return { sections: [], bodyStart: 0 }

  let bodyStart = lastSignal + 1
  for (let i = lastSignal + 1; i < trimmed.length; i++) {
    if (isBodyHeading(trimmed[i])) { bodyStart = i; break }
    if (isIntroducaoWord(trimmed[i])) {
      let j = i + 1
      while (j < trimmed.length && !trimmed[j]) j++
      if (j < trimmed.length && looksLikeBodyProse(trimmed[j])) { bodyStart = i; break }
    }
  }

  const sections: PretextualSection[] = []
  const leadingEnd = (firstLabeled === -1 ? bodyStart : firstLabeled) - 1
  if (leadingEnd >= 0) {
    const hasFolha = firstNatureza !== -1 && firstNatureza <= leadingEnd
    const yearLines: number[] = []
    for (let i = 0; i <= leadingEnd; i++) if (YEAR_LINE_RE.test(trimmed[i])) yearLines.push(i)

    if (hasFolha && yearLines.length >= 2) {
      sections.push({ kind: 'capa', blockStart: 0, blockEnd: yearLines[0] })
      sections.push({ kind: 'folhaDeRosto', blockStart: yearLines[0] + 1, blockEnd: leadingEnd })
    } else if (hasFolha) {
      sections.push({ kind: 'folhaDeRosto', blockStart: 0, blockEnd: leadingEnd })
    } else {
      sections.push({ kind: 'capa', blockStart: 0, blockEnd: leadingEnd })
    }
  }

  for (let k = 0; k < labeled.length; k++) {
    const start = labeled[k].index
    const end = (k + 1 < labeled.length ? labeled[k + 1].index : bodyStart) - 1
    sections.push({ kind: labeled[k].kind, blockStart: start, blockEnd: Math.max(start, end) })
  }

  return { sections, bodyStart }
}

/** Detect the pré-textual region from the document XML. */
export function detectPretextual(documentXml: string): PretextualResult {
  const blocks = getBlocks(documentXml)
  const texts = blocks.map(b => (isParagraph(b) ? blockText(b) : ''))
  return classifyPretextual(texts)
}

/**
 * Stamp the unnumbered-title style (centered, bold, UPPERCASE) on each *labeled*
 * pré-textual heading — RESUMO, ABSTRACT, SUMÁRIO, the listas, agradecimentos, errata,
 * folha de aprovação. The covers (capa, folha de rosto) carry no label heading and are
 * left untouched here. Idempotent and block-index aligned with the rest of the pipeline.
 */
export function applyPretextualHeadings(documentXml: string, sections: PretextualSection[]): string {
  const labeled = sections.filter(s => LABELED_KINDS.has(s.kind))
  if (labeled.length === 0) return documentXml

  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  for (const s of labeled) {
    const block = blocks[s.blockStart]
    if (block && isParagraph(block)) {
      byIndex.set(s.blockStart, setParagraphStyle(block, REFERENCES_HEADING_STYLE))
    }
  }
  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}

/**
 * Center every paragraph of the cover (capa) — all of its text (institution, author,
 * title, city, year) is centered in ABNT, not justified/indented like the body. Stamps
 * the `COVER_STYLE` paragraph style; author run-level emphasis (a bold/larger title)
 * survives as a direct run override. Image paragraphs (a logo) are centered too.
 * (Folha de rosto is handled separately by `applyFolhaRostoAlignment`.)
 */
export function applyCoverAlignment(documentXml: string, sections: PretextualSection[]): string {
  const covers = sections.filter(s => CENTER_KINDS.has(s.kind))
  if (covers.length === 0) return documentXml

  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()
  for (const s of covers) {
    for (let i = s.blockStart; i <= s.blockEnd; i++) {
      const block = blocks[i]
      if (block && isParagraph(block)) byIndex.set(i, setParagraphStyle(block, COVER_STYLE))
    }
  }
  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}

/**
 * Apply ABNT folha de rosto alignment: most text (author, title, city, year) is
 * centered; the natureza note ("apresentada como requisito parcial…" + orientador line)
 * is indented to the right half of the page per NBR 14724.
 *
 * Within each folha de rosto section, scans for the natureza/orientador block and
 * stamps `FOLHA_ROSTO_NATUREZA_STYLE` on those paragraphs; all others get `COVER_STYLE`
 * (centered). If no natureza text is found, all paragraphs are centered as a fallback.
 */
export function applyFolhaRostoAlignment(documentXml: string, sections: PretextualSection[]): string {
  const folhas = sections.filter(s => s.kind === 'folhaDeRosto')
  if (folhas.length === 0) return documentXml

  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()

  for (const s of folhas) {
    // Find the natureza block range within this section: first and last line that
    // matches NATUREZA_RE or ORIENTADOR_RE. Everything in [nStart, nEnd] is right-offset;
    // blank lines between them are included so the indented block is visually continuous.
    let nStart = -1
    let nEnd = -1
    for (let i = s.blockStart; i <= s.blockEnd; i++) {
      const text = isParagraph(blocks[i]) ? blockText(blocks[i]) : ''
      if (NATUREZA_RE.test(text) || ORIENTADOR_RE.test(text)) {
        if (nStart === -1) nStart = i
        nEnd = i
      }
    }

    for (let i = s.blockStart; i <= s.blockEnd; i++) {
      const block = blocks[i]
      if (!block || !isParagraph(block)) continue
      const isNatureza = nStart !== -1 && i >= nStart && i <= nEnd
      byIndex.set(i, setParagraphStyle(block, isNatureza ? FOLHA_ROSTO_NATUREZA_STYLE : COVER_STYLE))
    }
  }

  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}

/**
 * Insert a page break before the first paragraph of every pré-textual section except
 * the first (which starts at the beginning of the document). ABNT requires each element
 * (capa, folha de rosto, resumo, sumário, …) to start on its own page.
 *
 * Adds `<w:pageBreakBefore/>` to the paragraph properties of the opening block of each
 * section[1+]. Does not insert new blocks, so absolute block indices stay stable.
 * Idempotent — will not double-add if called twice.
 */
export function applyPretextualPageBreaks(documentXml: string, sections: PretextualSection[]): string {
  if (sections.length <= 1) return documentXml

  const blocks = getBlocks(documentXml)
  const byIndex = new Map<number, string>()

  for (let k = 1; k < sections.length; k++) {
    const blockIdx = sections[k].blockStart
    const block = blocks[blockIdx]
    if (!block || !isParagraph(block)) continue
    if (/<w:pageBreakBefore\b/.test(block)) continue // already set
    byIndex.set(blockIdx, addPageBreakBefore(block))
  }

  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}

/** Read a twips attribute (e.g. `w:top="1701"`) off an OOXML tag string. */
function twipAttr(tag: string, attr: string): number {
  const m = tag.match(new RegExp(`${attr}="(\\d+)"`))
  return m ? parseInt(m[1], 10) : 0
}

/** Kinds that get full-page vertical distribution (content centered, city/year at the foot). */
const DISTRIBUTE_KINDS: ReadonlySet<PretextualKind> = new Set<PretextualKind>(['capa', 'folhaDeRosto'])

/** A standalone city line above the year: letters/separators only (no digits, no sentence). */
const CITY_LINE_RE = /^[\p{L}][\p{L}\s.'’\-–—]*$/u
/** A combined "City – 2026" / "City, 2026" / "City 2026" line. */
const CITY_YEAR_LINE_RE = /^[\p{L}][\p{L}\s.'’\-–—]*[,\s\-–—]\s*(19|20)\d{2}$/u

/** Twips reserved at the page bottom per foot line (≈ a 12pt 1.5-spaced line + slack). */
const FOOT_LINE_TWIPS = 400
/** Extra breathing room added to the foot zone. */
const FOOT_PAD_TWIPS = 200
/** Safety slack so a page's rows never sum past the exact content height (renderer rounding). */
const PAGE_SLACK_TWIPS = 60

/**
 * Is this text plausibly the cover's city line (the line right above the year)?
 * Deliberately strict — a false positive would drag the TITLE to the page foot:
 * short, few words, not ALL-CAPS (capa titles/institutions are uppercase; city
 * lines are title-case), and never the natureza/orientador note.
 */
function isCityLine(text: string): boolean {
  if (!text || text.length > 30) return false
  if (!CITY_LINE_RE.test(text)) return false
  if (text.split(/\s+/).length > 4) return false
  if (text === text.toUpperCase()) return false
  return !NATUREZA_RE.test(text) && !ORIENTADOR_RE.test(text)
}

/** True when the paragraph starts a new page (`<w:pageBreakBefore/>`, not an explicit off). */
function hasPageBreakBefore(block: string): boolean {
  const m = block.match(/<w:pageBreakBefore\b[^>]*\/?>/)
  return !!m && !/w:val="(?:false|0)"/.test(m[0])
}

/** True when the paragraph contains an explicit page-break run (`<w:br w:type="page"/>`). */
const hasPageBreakRun = (block: string) => /<w:br\b[^>]*w:type="page"/.test(block)

/**
 * True when this paragraph's own `<w:pPr>` carries a `<w:sectPr>` — a Word "Section
 * Break (Next Page)" mid-document. OOXML attaches a section break to the LAST
 * paragraph of the ending section (not the first of the next one), which is why this
 * looks nothing like `hasPageBreakBefore`. Common in ABNT templates to restart page
 * numbering between the cover pages and the body — `splitPageGroups` previously only
 * recognized `pageBreakBefore`/an explicit break run, so a section break here merged
 * capa and folha de rosto into one undivided page group: the capa's own city/year line
 * (not at the tail of that merged group) was swept into the oversized "main" row
 * instead of pinned to a foot, and the row-height arithmetic downstream (sized for one
 * page but fed ~2 pages of content) drifted enough to strand the real foot content on
 * a spurious extra page.
 */
const hasSectionBreak = (block: string) => {
  const pPr = block.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0]
  return !!pPr && /<w:sectPr\b/.test(pPr)
}

/**
 * Remove page-break artifacts from a paragraph that is moving inside a table cell.
 * Word/LibreOffice ignore `pageBreakBefore` inside tables and render a break run as a
 * stray blank line — the exact-height rows now own the pagination, so both go. A
 * `<w:sectPr>` nested in a table-cell paragraph is invalid OOXML (it must be a direct
 * child of `<w:body>` or of a paragraph that itself is), so it is stripped too — the
 * merged table already borrows its geometry from the document's final `<w:sectPr>`,
 * so the intermediate section's own properties were never honored here anyway.
 */
function stripPageBreaks(block: string): string {
  return block
    .replace(/<w:pageBreakBefore\b[^>]*\/>/g, '')
    .replace(/<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br\b[^>]*w:type="page"[^>]*\/><\/w:r>/g, '')
    .replace(/<w:br\b[^>]*w:type="page"[^>]*\/>/g, '')
    .replace(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g, '')
}

interface PageGroup {
  start: number
  end: number
}

/**
 * Split a section's block range into the author's own pages, using ONLY their explicit,
 * unambiguous break signals: `pageBreakBefore` starts a new group at that block; a
 * `<w:br w:type="page"/>` run or a mid-body `<w:sectPr>` (a Word "Section Break (Next
 * Page)", common between covers and the body to restart page numbering) ends the group
 * at that block. A section with no such markers is ONE group.
 *
 * A run of blank paragraphs is deliberately NOT treated as a page-boundary signal, even
 * though a long one could be an author manually hitting Enter to push content down
 * instead of using "page break" — a real, tried, and reverted approach (see git history:
 * `findBlankRuns`/`BLANK_RUN_MIN_TWIPS`). The problem: ABNT requires the capa and folha de
 * rosto to each be exactly ONE page — the whole point of this function's caller,
 * `applyCoverVerticalDistribution` (vAlign=center for the main content + a pinned foot for
 * the city/year), is to REPLACE an author's manual blank-line vertical spacing with a
 * proper one-page layout. Treating that same manual spacing as a "push to a new page"
 * signal directly defeats that purpose for the single most common real-world shape: a
 * capa with generous blank-line gaps between institution / author / title / city+year,
 * confirmed on a real document where 10 blank lines between the institution and the
 * author's name split what must be one page into three. `classifyPretextual` already
 * delimits each section's own end at its own year line (`sections.push({ kind: 'capa',
 * blockStart: 0, blockEnd: yearLines[0] })`), so `detectFoot` finds the right city/year
 * tail correctly with the whole section as ONE group — no blank-run detection needed for
 * that. This matters for the merged capa+folha case too (a single-year-line document
 * collapses both covers into one `folhaDeRosto` section spanning several real pages) —
 * but only an explicit break marker between them is trusted to split that; if the author
 * used neither a real break there, the (rarer) merged case stays one group, same as any
 * other content lacking an explicit marker.
 */
function splitPageGroups(blocks: string[], start: number, end: number): PageGroup[] {
  const groups: PageGroup[] = []
  let a = start
  for (let i = start; i <= end; i++) {
    if (i > a && hasPageBreakBefore(blocks[i])) {
      groups.push({ start: a, end: i - 1 })
      a = i
    }
    if ((hasPageBreakRun(blocks[i]) || hasSectionBreak(blocks[i])) && i < end) {
      groups.push({ start: a, end: i })
      a = i + 1
    }
  }
  if (a <= end) groups.push({ start: a, end })
  return groups
}

/** The trailing city/year block range of a page group, or null when the page has none. */
function detectFoot(texts: string[], g: PageGroup): PageGroup | null {
  let last = g.end
  while (last >= g.start && !texts[last]) last--
  if (last < g.start) return null

  const t = texts[last]
  if (YEAR_LINE_RE.test(t)) {
    // Bare year — take the short city line right above it (skipping blanks) too.
    let prev = last - 1
    while (prev >= g.start && !texts[prev]) prev--
    if (prev >= g.start && isCityLine(texts[prev])) return { start: prev, end: last }
    return { start: last, end: last }
  }
  if (t.length <= 70 && CITY_YEAR_LINE_RE.test(t)) return { start: last, end: last }
  return null
}

/** A plausible "maintaining institution" header line: university/institute/faculty/
 * department/center/school name — almost always present, and almost always ALL-CAPS, at
 * the very top of a real ABNT capa. Folha de rosto conventionally does NOT repeat this
 * (it opens with the author's name instead), so keying on these keywords — rather than
 * "whatever the first line is" — naturally limits this to the capa without needing to
 * know which section kind is being processed. */
const INSTITUTION_LINE_RE = /\b(UNIVERSIDADE|INSTITUTO|FACULDADE|DEPARTAMENTO|CENTRO|ESCOLA|COL[ÉE]GIO|CAMPUS)\b/i

/**
 * Max lines a plausible institution header can span before we stop trusting it's still
 * the header — a real one is short (university, institute, department, rarely more than
 * 3-4 lines). Without this cap, a page with no blank line separating the header from
 * whatever follows (an unusual document, or a test fixture) would swallow the author,
 * title, or even the foot's own city/year into the top-aligned zone.
 */
const MAX_HEADER_LINES = 4

/**
 * The leading "maintaining institution" header block of a page group — per ABNT NBR
 * 14724, it belongs at the TOP of the capa, not centered together with the author/title
 * block below it. Returns the run of non-blank lines at the very start of the group, up
 * to (not including) the first blank gap, `MAX_HEADER_LINES`, or `stopBefore` (pass the
 * foot's own start index — the two must never overlap), whichever comes first. Only when
 * the opening line actually reads like an institution name (`INSTITUTION_LINE_RE`) —
 * otherwise null, so a group that doesn't open with one (folha de rosto; a capa authored
 * without an institution line) is left exactly as before.
 */
function detectHeader(texts: string[], g: PageGroup, stopBefore: number): PageGroup | null {
  let first = g.start
  while (first <= g.end && !texts[first]) first++
  if (first >= stopBefore || first > g.end || !INSTITUTION_LINE_RE.test(texts[first])) return null

  const limit = Math.min(g.end, stopBefore - 1, first + MAX_HEADER_LINES - 1)
  let last = first
  while (last + 1 <= limit && texts[last + 1]) last++
  return { start: first, end: last }
}

/**
 * Reduce a structured-document-tag block to a plain paragraph carrying just its visible
 * text, discarding whatever internal wrapper structure it had. Google Docs export can
 * leave an `<w:sdt>`'s content in a shape that's borderline-malformed OOXML (a bare
 * `<w:ins>` tracked-change marker as a direct, non-paragraph child; a `<w:sdt>` nested
 * inside another) — LibreOffice tolerates this when it's a body-level block (real
 * incident: this exact shape converted fine at the body level, but silently produced NO
 * output PDF once moved verbatim into a `<w:tc>`, a stricter validation path). A plain
 * paragraph is unconditionally safe there. Losing the tracked-change wrapper is fine —
 * we only need the reader to still see the text, not Google Docs' revision metadata.
 */
function simplifyStructuredDocTag(block: string): string {
  const text = blockText(block)
  return text ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>` : '<w:p/>'
}

/** One borderless table row: a full-width cell with the given height and vertical alignment. */
function buildRow(cellBlocks: string[], height: number, vAlign: 'top' | 'center' | 'bottom', contentW: number): string {
  const content = cellBlocks.length ? cellBlocks.join('') : '<w:p/>'
  return (
    `<w:tr><w:trPr><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>` +
    `<w:tc><w:tcPr><w:tcW w:w="${contentW}" w:type="dxa"/><w:vAlign w:val="${vAlign}"/></w:tcPr>${content}</w:tc></w:tr>`
  )
}

/**
 * Max consecutive blank paragraphs kept between real content in a page's main (non-foot)
 * zone — enough for a visible gap between capa zones (institution / author / title)
 * without the row's total height threatening to exceed one page. Real incident: a capa
 * where 40 of its 48 blocks were blank (the author manually pushing institution → author
 * → title apart, having no other way to position them) still overflowed onto a second
 * page after the page-boundary fix above, because every one of those blank paragraphs
 * was still preserved verbatim inside the single vAlign=center row. That defeats the
 * entire point of this table: vAlign=center already distributes the content vertically
 * within the page on its own — it needs no artificial blank-paragraph padding to do it,
 * and keeping all of it just re-introduces the overflow risk this function exists to
 * eliminate.
 */
const MAX_BLANK_RUN_IN_MAIN = 2

/** `[from, to]` inclusive as a plain index array. */
function indexRange(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}

/**
 * Drop any run of GENUINELY blank paragraphs beyond `max` consecutive ones (keeping the
 * first `max` of each run for a visual gap); every other index passes through untouched.
 * Deliberately checks `isParagraph` too, not just `texts[i]` being falsy — a `<w:sdt>`
 * block (real case: a run of to-do-list entries, each its own sdt) ALSO reads as blank
 * text via `texts` (the same convention `blockText`/`isParagraph` use everywhere else in
 * this file), but it is real content once `simplifyStructuredDocTag` runs, not filler —
 * treating it as part of a blank run silently dropped most of that content in an earlier
 * version of this function.
 */
function capBlankRuns(indices: number[], blocks: string[], texts: string[], max: number): number[] {
  const out: number[] = []
  let streak = 0
  for (const i of indices) {
    if (isParagraph(blocks[i]) && !texts[i]) {
      streak++
      if (streak <= max) out.push(i)
    } else {
      streak = 0
      out.push(i)
    }
  }
  return out
}

/**
 * Rows for one cover page, in up to three zones per ABNT NBR 14724: a top-aligned header
 * zone when the page opens with a maintaining-institution line (`detectHeader`); a
 * centered main zone for whatever's left (author, title, …); and a bottom-aligned foot
 * zone when the page ends with a city/year block (`detectFoot`), so the city/date sit on
 * the page's last lines. Either zone is optional — a page with neither is just the
 * original single centered row. Trailing blank paragraphs after the year are dropped:
 * they were the author's manual push-down, and the foot row now owns that job. The main
 * zone's own blank runs are capped the same way (`capBlankRuns`) — header/foot ranges are
 * never more than a couple of lines in practice, so they're left as-is.
 */
function buildGroupRows(blocks: string[], texts: string[], g: PageGroup, contentW: number, contentH: number): string[] {
  const cleanBlock = (i: number) => (isStructuredDocTag(blocks[i]) ? simplifyStructuredDocTag(blocks[i]) : stripPageBreaks(blocks[i]))
  const foot = detectFoot(texts, g)
  const header = detectHeader(texts, g, foot ? foot.start : g.end + 1)

  const headerBlocks = header ? indexRange(header.start, header.end).map(cleanBlock) : []
  const headerH = header ? headerBlocks.length * FOOT_LINE_TWIPS + FOOT_PAD_TWIPS : 0
  const footBlocks = foot ? indexRange(foot.start, foot.end).map(cleanBlock) : []
  const footH = foot ? footBlocks.length * FOOT_LINE_TWIPS + FOOT_PAD_TWIPS : 0

  const mainStart = header ? header.end + 1 : g.start
  const mainEnd = foot ? foot.start - 1 : g.end
  const mainIdx = mainStart <= mainEnd ? capBlankRuns(indexRange(mainStart, mainEnd), blocks, texts, MAX_BLANK_RUN_IN_MAIN) : []
  const mainBlocks = mainIdx.map(cleanBlock)

  const rows: string[] = []
  if (header) rows.push(buildRow(headerBlocks, headerH, 'top', contentW))
  rows.push(buildRow(mainBlocks, contentH - headerH - footH - PAGE_SLACK_TWIPS, 'center', contentW))
  if (foot) rows.push(buildRow(footBlocks, footH, 'bottom', contentW))
  return rows
}

/**
 * Vertically distribute the cover pages (capa AND folha de rosto) within their pages:
 * the content is centered in the page's main zone and the trailing city/year lines are
 * pinned to the page foot, per ABNT NBR 14724. (Full 3-zone layout — institution top /
 * title middle — still needs per-field classification, tracked separately in
 * `business_decisions/pretextual-elements.html`; center+foot is the scoped middle ground.)
 *
 * THREE APPROACHES WERE TRIED AND EMPIRICALLY VERIFIED AGAINST THE REAL PDF EXPORT PATH
 * (LibreOffice headless, `docxToPdf.ts`) before landing on this one:
 *  1. A fixed `spaceBefore` push on the city/year line (the original `applyCoverYearBottom`)
 *     — a constant tuned against one content height; a longer/shorter capa pushed the
 *     break to the wrong page. This is the bug that prompted the rewrite.
 *  2. OOXML section-level `<w:vAlign w:val="both|center|bottom"/>` (Word's native
 *     "vertical justify a page" property) — textbook-correct per the spec, but
 *     LibreOffice 26.2 silently ignores it (verified with `both`, `center`, `bottom`).
 *  3. **Table-cell `vAlign` (what this function does)** — LibreOffice DOES honor
 *     `<w:vAlign>` inside `<w:tcPr>`. A borderless table sized to the page content
 *     area renders exactly as laid out in the exported PDF. No constant to tune — the
 *     geometry comes from the document's own page size/margins.
 *
 * Each section is split into the author's own pages (`splitPageGroups`) and every page
 * becomes a main row (`vAlign=center`) plus, when it ends with a city/year block, a foot
 * row (`vAlign=bottom`); each page's rows sum to the page content height, so pagination
 * is enforced by the row heights themselves. Contiguous cover sections (capa directly
 * followed by folha de rosto) are merged into ONE `<w:tbl>` — two adjacent tables would
 * be merged by Word anyway, with unpredictable layout.
 *
 * Collapses N paragraphs into ONE `<w:tbl>` block per cover run, so the caller MUST run
 * this only after every other block-index-dependent pass is done (Step C/D, Step P,
 * sumário, captions/placeholders — anything keyed on `PretextualResult`/`ReferenceRegion`
 * indices). `processFormatting` runs it last, re-detecting pré-textuais fresh at that point.
 */
export function applyCoverVerticalDistribution(documentXml: string, sections: PretextualSection[]): string {
  const targets = sections
    .filter(s => DISTRIBUTE_KINDS.has(s.kind))
    .sort((a, b) => a.blockStart - b.blockStart)
  if (targets.length === 0) return documentXml

  const finalSectPr = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/)?.[0]
  if (!finalSectPr) return documentXml
  const pgSz = finalSectPr.match(/<w:pgSz\b[^>]*\/>/)?.[0]
  const pgMar = finalSectPr.match(/<w:pgMar\b[^>]*\/>/)?.[0]
  if (!pgSz || !pgMar) return documentXml

  const contentW = twipAttr(pgSz, 'w:w') - twipAttr(pgMar, 'w:left') - twipAttr(pgMar, 'w:right')
  const contentH = twipAttr(pgSz, 'w:h') - twipAttr(pgMar, 'w:top') - twipAttr(pgMar, 'w:bottom')
  if (contentW <= 0 || contentH <= 0) return documentXml

  const blocks = getBlocks(documentXml)
  const texts = blocks.map(b => (isParagraph(b) ? blockText(b).trim() : ''))

  // Merge contiguous cover sections into one run → one table per run.
  const tableRuns: PretextualSection[][] = []
  for (const s of targets) {
    const prev = tableRuns[tableRuns.length - 1]
    if (prev && prev[prev.length - 1].blockEnd + 1 === s.blockStart) prev.push(s)
    else tableRuns.push([s])
  }

  const byIndex = new Map<number, string>()
  for (const run of tableRuns) {
    const start = run[0].blockStart
    const end = run[run.length - 1].blockEnd
    // Skip a run that is already wrapped (idempotency) or contains something we can't nest.
    // `<w:sdt>` (a structured-document-tag — Google Docs export leaves these behind for
    // tracked-suggestion remnants, e.g. a stray to-do list the author forgot to delete) is
    // valid inside a table cell too and carries no text `blockText` can see, so it's treated
    // the same as a paragraph here — a real `<w:tbl>` is still the only thing that blocks it.
    let allCollapsible = true
    for (let i = start; i <= end; i++) {
      if (!isParagraph(blocks[i]) && !isStructuredDocTag(blocks[i])) { allCollapsible = false; break }
    }
    if (!allCollapsible) continue

    const rows: string[] = []
    for (const s of run) {
      for (const g of splitPageGroups(blocks, s.blockStart, s.blockEnd)) {
        rows.push(...buildGroupRows(blocks, texts, g, contentW, contentH))
      }
    }

    const table =
      '<w:tbl>' +
      `<w:tblPr><w:tblW w:w="${contentW}" w:type="dxa"/><w:tblBorders>` +
      '<w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/>' +
      '<w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>' +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
      '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
      `<w:tblGrid><w:gridCol w:w="${contentW}"/></w:tblGrid>` +
      rows.join('') +
      '</w:tbl>'

    byIndex.set(start, table)
    for (let i = start + 1; i <= end; i++) byIndex.set(i, '')
  }

  return byIndex.size ? replaceBlocks(documentXml, byIndex) : documentXml
}

/** Inject `<w:pageBreakBefore/>` into a paragraph's `<w:pPr>`, creating one if absent. */
function addPageBreakBefore(block: string): string {
  if (/<w:pPr\b[^>]*>/.test(block)) {
    return block.replace(/<\/w:pPr>/, '<w:pageBreakBefore/></w:pPr>')
  }
  if (/<w:pPr\b[^>]*\/>/.test(block)) {
    return block.replace(/<w:pPr\b[^>]*\/>/, '<w:pPr><w:pageBreakBefore/></w:pPr>')
  }
  return block.replace(/(<w:p\b[^>]*>)/, '$1<w:pPr><w:pageBreakBefore/></w:pPr>')
}

/**
 * Suppress the page-number header on the capa's own first page — ABNT requires the capa
 * to show no page number at all, even though it IS counted in the total. Real documents
 * commonly carry a header with an auto `PAGE` field applied to every page uniformly
 * (confirmed on a real thesis: a single Word section, one `<w:headerReference>`, no
 * per-page override), which is not itself something this pipeline generates — it's
 * inherited from whatever template/export produced the original file.
 *
 * Uses OOXML's "different first page" flag, `<w:titlePg/>`, on the document's own
 * section: with no `w:type="first"` header/footer reference provided alongside it,
 * Word/LibreOffice render NO header on the section's first physical page, while every
 * later page keeps using the document's normal header untouched — exactly "hide the
 * capa's number, leave everything else numbered." A no-op when there's no cover section
 * (nothing to suppress a number for) or the flag is already present (idempotent).
 *
 * Scoped deliberately narrow: only the flag itself, nothing about the fuller pré-textual
 * roman-numeral / body-restarts-at-1 numbering convention some ABNT templates also use —
 * that's a separate, bigger feature (tracked in `docs`/`business_decisions`), not implied
 * by "the cover shouldn't show a number."
 */
export function suppressCoverPageNumber(documentXml: string, sections: PretextualSection[]): string {
  const hasCover = sections.some(s => DISTRIBUTE_KINDS.has(s.kind))
  if (!hasCover) return documentXml

  const finalSectPr = documentXml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>(?=\s*<\/w:body>)/)?.[0]
  if (!finalSectPr) return documentXml
  if (/<w:titlePg\/>/.test(finalSectPr)) return documentXml

  const updated = finalSectPr.replace(/<\/w:sectPr>$/, '<w:titlePg/></w:sectPr>')
  return documentXml.replace(finalSectPr, updated)
}
