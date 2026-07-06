import { getBlocks, isParagraph, blockText, setParagraphStyle, replaceBlocks } from './blocks'
import { REFERENCES_HEADING_STYLE, COVER_STYLE, FOLHA_ROSTO_NATUREZA_STYLE } from './guidelines'

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
 * Remove page-break artifacts from a paragraph that is moving inside a table cell.
 * Word/LibreOffice ignore `pageBreakBefore` inside tables and render a break run as a
 * stray blank line — the exact-height rows now own the pagination, so both go.
 */
function stripPageBreaks(block: string): string {
  return block
    .replace(/<w:pageBreakBefore\b[^>]*\/>/g, '')
    .replace(/<w:r>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:br\b[^>]*w:type="page"[^>]*\/><\/w:r>/g, '')
    .replace(/<w:br\b[^>]*w:type="page"[^>]*\/>/g, '')
}

interface PageGroup {
  start: number
  end: number
}

/**
 * Split a section's block range into the author's own pages, using their explicit
 * break signals: `pageBreakBefore` starts a new group at that block; a `<w:br
 * w:type="page"/>` run ends the group at that block. A section with no breaks is one
 * group. This matters for the merged capa+folha case (a single-year-line document
 * collapses both covers into one `folhaDeRosto` section spanning several real pages) —
 * each real page still gets its own centered zone and its own pinned city/year foot.
 */
function splitPageGroups(blocks: string[], start: number, end: number): PageGroup[] {
  const groups: PageGroup[] = []
  let a = start
  for (let i = start; i <= end; i++) {
    if (i > a && hasPageBreakBefore(blocks[i])) {
      groups.push({ start: a, end: i - 1 })
      a = i
    }
    if (hasPageBreakRun(blocks[i]) && i < end) {
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

/** One borderless table row: a full-width cell with the given height and vertical alignment. */
function buildRow(cellBlocks: string[], height: number, vAlign: 'center' | 'bottom', contentW: number): string {
  const content = cellBlocks.length ? cellBlocks.join('') : '<w:p/>'
  return (
    `<w:tr><w:trPr><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>` +
    `<w:tc><w:tcPr><w:tcW w:w="${contentW}" w:type="dxa"/><w:vAlign w:val="${vAlign}"/></w:tcPr>${content}</w:tc></w:tr>`
  )
}

/**
 * Rows for one cover page: a centered main zone plus — when the page ends with a
 * city/year block — a bottom-aligned foot zone, so the city/date sit on the page's
 * last lines per ABNT NBR 14724. Trailing blank paragraphs after the year are dropped:
 * they were the author's manual push-down, and the foot row now owns that job.
 */
function buildGroupRows(blocks: string[], texts: string[], g: PageGroup, contentW: number, contentH: number): string[] {
  const clean = (from: number, to: number) => blocks.slice(from, to + 1).map(stripPageBreaks)
  const foot = detectFoot(texts, g)
  if (!foot) return [buildRow(clean(g.start, g.end), contentH - PAGE_SLACK_TWIPS, 'center', contentW)]

  const footBlocks = clean(foot.start, foot.end)
  const footH = footBlocks.length * FOOT_LINE_TWIPS + FOOT_PAD_TWIPS
  const mainBlocks = foot.start > g.start ? clean(g.start, foot.start - 1) : []
  return [
    buildRow(mainBlocks, contentH - footH - PAGE_SLACK_TWIPS, 'center', contentW),
    buildRow(footBlocks, footH, 'bottom', contentW),
  ]
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
    let allParagraphs = true
    for (let i = start; i <= end; i++) {
      if (!isParagraph(blocks[i])) { allParagraphs = false; break }
    }
    if (!allParagraphs) continue

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
