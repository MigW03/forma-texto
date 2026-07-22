/**
 * ABNT pré-textual element detection (client-side, text-only).
 *
 * Pré-textuais are the front-matter pages that come BEFORE the body of an academic
 * work: capa (cover), folha de rosto (title page / "second cover"), folha de
 * aprovação, dedicatória, agradecimentos, epígrafe, errata, resumo, abstract, the
 * listas (de figuras/tabelas/abreviaturas), and the sumário. None of them are
 * "laudas" — they are not billed or sliced like body text — so the page-selection
 * UI classifies them under a separate "Pre text elements" group instead of folding
 * them into Lauda 1.
 *
 * The detector is deliberately split by reliability (mirrors business_decisions/
 * pretextual-elements.html):
 *  - **Labeled sections** (resumo, abstract, sumário, listas, …) carry a fixed,
 *    unnumbered heading word → matched with an anchored regex. High confidence.
 *  - **Cover pages** (capa, folha de rosto) carry no label → located by position
 *    plus the natureza note / orientador line / year-line anchors. Best-effort; the
 *    capa↔folha split is the heuristic part and may be coarse.
 *
 * Input is text-only (`{ text }[]`) so it runs equally on `getDocxBlocks` output and
 * on the rendered docx-preview DOM (`element.textContent`). Block indices in the
 * result are ABSOLUTE — the same indices laudas/dividers use.
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
  /** Detected sections in document order. Empty when no pré-textuais are found. */
  sections: PretextualSection[]
  /**
   * First body-text block index — laudas are computed from here on, so blocks
   * `[0, bodyStart)` are the pré-textual region. `0` means nothing was detected
   * (the whole document is body, current behaviour preserved).
   */
  bodyStart: number
}

/** Anchored label matchers, in no particular order — a block whose whole (trimmed) text is the label. */
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

/**
 * The natureza note + orientador line are the folha-de-rosto fingerprint (no label).
 * It must be the actual presentation phrase — "X apresentada ao … como requisito parcial
 * para obtenção do título/grau de …". We deliberately do NOT match bare thesis-type words
 * (tese/dissertação/monografia) on their own: those appear all over normal body prose
 * ("nesta dissertação analisamos…") and would falsely flag real chapters as front matter.
 */
const NATUREZA_RE =
  /apresentad[oa]\s+(a|ao|à)\b|requisito\s+parcial|obten[çc][ãa]o\s+d[eo]\s+(t[íi]tulo|grau)|trabalho de conclus[ãa]o de curso/i
const ORIENTADOR_RE = /orientador(a)?\s*[:-]/i

/** A lone 4-digit year on its own line — the bottom anchor of capa / folha de rosto. */
const YEAR_LINE_RE = /^(19|20)\d{2}$/

/** A sumário (TOC) entry: dot leaders or a trailing page number. Used to skip the listing. */
function isTocEntry(text: string): boolean {
  if (!text) return false
  return /\.{2,}\s*\d{1,4}$/.test(text) || /\s\d{1,4}$/.test(text)
}

/**
 * A real body heading: a section number followed by a word ("1 INTRODUÇÃO",
 * "1.1 Contexto"). Rejected if it looks like a TOC entry (trailing page number / dot
 * leaders) so sumário lines never match. The unnumbered word "Introdução" is handled
 * separately (`isIntroducaoWord` + `looksLikeBodyProse`) since telling it apart from a
 * same-text TOC entry needs lookahead context this function doesn't have.
 */
function isBodyHeading(text: string): boolean {
  if (!text || isTocEntry(text)) return false
  if (/^\d+(\.\d+)*\.?\s+\p{L}/u.test(text)) return true
  return false
}

/**
 * The bare word "Introdução" — matches whether or not the author (or Word's own
 * `<w:numPr>` multilevel-list numbering, invisible to plain text) has numbered it yet.
 * Ambiguous on its own: the sumário lists the same bare word as a TOC entry when the
 * author hasn't paginated it (no trailing page number for `isTocEntry` to key on) —
 * `looksLikeBodyProse` supplies the context check that tells the two apart.
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
 * Detect the pré-textual region at the front of a document.
 *
 * Strategy:
 *  1. Scan for "signals" — labeled-section anchors and the natureza/orientador
 *     lines. No signal ⇒ no pré-textuais (bodyStart 0).
 *  2. `bodyStart` = the first real body heading AFTER the last signal (sumário TOC
 *     entries are rejected by `isBodyHeading`, so the real "1 INTRODUÇÃO" wins). If
 *     none is found, fall back to just past the last signal (conservative: under-
 *     extends rather than swallowing body laudas).
 *  3. Build sections: the leading unlabeled region (before the first labeled anchor)
 *     is capa / folha de rosto, split by the natureza note + year lines; each
 *     labeled anchor owns the range up to the next anchor (or bodyStart).
 */
export function detectPretextual(blocks: { text: string }[]): PretextualResult {
  const texts = blocks.map(b => b.text.trim())

  // 1. Collect signals.
  const labeled: { kind: PretextualKind; index: number }[] = []
  let lastSignal = -1
  let firstNatureza = -1
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]
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

  // 2. Find where the body begins.
  //
  // First, skip a leading run of blank lines and TOC-entry-shaped lines (dot
  // leaders or a trailing page number — `isTocEntry`) right after the last signal.
  // When that signal is the sumário label, this run is almost always its own
  // paginated entry list — skipping it gives a far better default than
  // "immediately after the label" for a document whose real chapters aren't
  // numbered yet (heading numbering is itself something the pipeline adds, so a
  // fresh upload commonly arrives without it). Without this skip, every TOC entry
  // AND the entire real body would fall through `isBodyHeading`'s numbered-heading
  // check, find nothing, and get counted as laudas. Harmless for other labeled
  // sections (resumo/abstract/…): their own body prose essentially never ends in a
  // bare trailing number or dot leaders, so the skip is a no-op there.
  let afterEntries = lastSignal + 1
  while (afterEntries < texts.length && (!texts[afterEntries] || isTocEntry(texts[afterEntries]))) {
    afterEntries++
  }

  let bodyStart = afterEntries < texts.length ? afterEntries : lastSignal + 1
  for (let i = afterEntries; i < texts.length; i++) {
    if (isBodyHeading(texts[i])) { bodyStart = i; break }
    if (isIntroducaoWord(texts[i])) {
      let j = i + 1
      while (j < texts.length && !texts[j]) j++
      if (j < texts.length && looksLikeBodyProse(texts[j])) { bodyStart = i; break }
    }
  }

  // 3. Build the section list.
  const sections: PretextualSection[] = []

  // 3a. Leading unlabeled region (capa + folha de rosto) — everything before the
  //     first labeled anchor, or before bodyStart when there is no labeled anchor.
  const leadingEnd = (firstLabeled === -1 ? bodyStart : firstLabeled) - 1
  if (leadingEnd >= 0) {
    const hasFolha = firstNatureza !== -1 && firstNatureza <= leadingEnd
    const yearLines: number[] = []
    for (let i = 0; i <= leadingEnd; i++) if (YEAR_LINE_RE.test(texts[i])) yearLines.push(i)

    if (hasFolha && yearLines.length >= 2) {
      // Two page bottoms ⇒ capa ends at the first year line, folha de rosto follows.
      sections.push({ kind: 'capa', blockStart: 0, blockEnd: yearLines[0] })
      sections.push({ kind: 'folhaDeRosto', blockStart: yearLines[0] + 1, blockEnd: leadingEnd })
    } else if (hasFolha) {
      // Can't split confidently — treat the whole leading region as folha de rosto.
      sections.push({ kind: 'folhaDeRosto', blockStart: 0, blockEnd: leadingEnd })
    } else {
      sections.push({ kind: 'capa', blockStart: 0, blockEnd: leadingEnd })
    }
  }

  // 3b. Each labeled anchor owns the range up to the next anchor (or bodyStart).
  for (let k = 0; k < labeled.length; k++) {
    const start = labeled[k].index
    const end = (k + 1 < labeled.length ? labeled[k + 1].index : bodyStart) - 1
    sections.push({ kind: labeled[k].kind, blockStart: start, blockEnd: Math.max(start, end) })
  }

  return { sections, bodyStart }
}
