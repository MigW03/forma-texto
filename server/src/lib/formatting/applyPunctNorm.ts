import { BLOCK_RE, isParagraph, getBlocks, replaceBlocks } from './blocks'

/** Per-rule counts, surfaced for logging so we can see what the step actually did. */
export interface PunctStats {
  /** Runs of 2+ spaces collapsed to one. */
  doubleSpaces: number
  /** Spaces removed immediately before sentence punctuation (intra-run). */
  spaceBeforePunct: number
  /** Missing spaces inserted after sentence punctuation (intra-run). */
  spaceAfterPunct: number
  /** Straight quotes/apostrophes turned into typographic (curly) ones. */
  smartQuotes: number
  /** `...` sequences turned into a unicode ellipsis. */
  ellipsis: number
  /** Spaced hyphens/en-dashes turned into a spaced em dash. */
  emDashes: number
  /** Spaces between a number and its unit replaced with a non-breaking space. */
  nbsp: number
  /** Trailing spaces trimmed before punctuation that lived in the next run (cross-run). */
  crossRunTrims: number
}

const emptyStats = (): PunctStats => ({
  doubleSpaces: 0,
  spaceBeforePunct: 0,
  spaceAfterPunct: 0,
  smartQuotes: 0,
  ellipsis: 0,
  emDashes: 0,
  nbsp: 0,
  crossRunTrims: 0,
})

/** True when the step changed nothing — lets the caller log a single clean line. */
export const isNoopPunct = (s: PunctStats): boolean =>
  s.doubleSpaces + s.spaceBeforePunct + s.spaceAfterPunct + s.smartQuotes +
  s.ellipsis + s.emDashes + s.nbsp + s.crossRunTrims === 0

// Uppercase letters incl. Latin-1 accented (À–Þ minus × at U+00D7). Used to gate the
// space-after-PERIOD rule so we don't split lowercase URL domains ("site.net") or
// numbers ("1.000") — a sentence almost always restarts with a capital.
const UPPER = 'A-ZÀ-ÖØ-Þ'
// Any letter (both cases, accented). Used after comma/semicolon/colon, which are far
// safer to space than a period: numbers there use digits ("1,50", "10:30"), excluded
// because we require a LETTER (not a digit) immediately after the mark.
const LETTER = 'A-Za-zÀ-ÖØ-öø-ÿ'

// Units that take a non-breaking space after a number ("10 km" → "10 km").
// Deliberately conservative: multi-char units plus the most common physical single
// letters. A negative lookahead (no letter/digit/° follows) keeps "5 metros", "5 anos"
// etc. untouched, and longest-first ordering makes "5 min" match "min" before "m".
const UNITS = [
  'kHz', 'MHz', 'GHz', 'Hz',
  'km', 'hm', 'dm', 'cm', 'mm', 'nm', 'µm',
  'kg', 'mg', 'dg', 'cg', 'µg',
  'mL', 'dL', 'cL', 'µL',
  'min', 'ms',
  'kB', 'MB', 'GB', 'TB',
  '°C', '°F',
  'm', 'g', 'L', 'h', 's',
].sort((a, b) => b.length - a.length)
const UNIT_RE = new RegExp(`(\\d) (${UNITS.join('|')})(?![${LETTER}0-9°])`, 'g')

/**
 * One pass over a single <w:t> text node. Each rule both rewrites and counts, so the
 * stats reflect exactly what changed. Order matters: collapse spaces first, then the
 * quote/spacing/dash fixes, then the unit non-breaking space (which consumes a normal
 * space and so must come after the collapse pass).
 */
function normalizeRunText(text: string, stats: PunctStats): string {
  let t = text

  // 1. Collapse consecutive ASCII spaces into one (leaves NBSP alone).
  t = t.replace(/ {2,}/g, () => { stats.doubleSpaces++; return ' ' })

  // 2. Smart (typographic) quotes. Opening forms are recognised by what precedes them
  //    (start of run, whitespace, or an opening bracket/dash); everything else closes.
  //    An apostrophe between two letters (d'água) becomes a curly apostrophe.
  t = t.replace(new RegExp(`(^|[\\s(\\[{«—–-])"`, 'g'), (_m, pre) => { stats.smartQuotes++; return `${pre}“` })
  t = t.replace(/"/g, () => { stats.smartQuotes++; return '”' })
  t = t.replace(new RegExp(`([${LETTER}])'([${LETTER}])`, 'g'), (_m, a, b) => { stats.smartQuotes++; return `${a}’${b}` })
  t = t.replace(new RegExp(`(^|[\\s(\\[{«—–-])'`, 'g'), (_m, pre) => { stats.smartQuotes++; return `${pre}‘` })
  t = t.replace(/'/g, () => { stats.smartQuotes++; return '’' })

  // 3. Remove space immediately before sentence punctuation.
  t = t.replace(/ ([.,;:!?»])/g, (_m, p) => { stats.spaceBeforePunct++; return p })

  // 4. Insert a missing space AFTER a period/!/? when the next char is an uppercase
  //    letter (sentence restart). Uppercase guard keeps "researchgate.net", "1.000",
  //    "p.ex." and decimals untouched.
  t = t.replace(new RegExp(`([.!?])([${UPPER}])`, 'g'), (_m, p, c) => { stats.spaceAfterPunct++; return `${p} ${c}` })
  // Insert a missing space after comma/semicolon/colon when followed by any letter.
  t = t.replace(new RegExp(`([,;:])([${LETTER}])`, 'g'), (_m, p, c) => { stats.spaceAfterPunct++; return `${p} ${c}` })

  // 5. Spaced hyphen/en-dash → spaced em dash, the ABNT parenthetical dash. Inspect
  //    the surrounding chars without consuming them (so adjacent dashes both convert);
  //    a number on BOTH sides is a range ("2010 - 2020"), left as-is.
  t = t.replace(/ [-–]{1,2} /g, (m, offset: number, str: string) => {
    const before = str[offset - 1]
    const after = str[offset + m.length]
    if (before === undefined || after === undefined) return m // run edge — no context
    if (before === ' ' || after === ' ') return m // not tightly bounded
    if (/\d/.test(before) && /\d/.test(after)) return m // numeric range
    stats.emDashes++
    return ' — '
  })

  // 6. Three-dot ellipsis → unicode ellipsis. Lookarounds guard against matching the
  //    middle of a longer run of dots (e.g. "...." must stay unchanged).
  t = t.replace(/(?<!\.)\.\.\.(?!\.)/g, () => { stats.ellipsis++; return '…' })

  // 7. Non-breaking space between a number and its unit ("10 km" → "10 km").
  t = t.replace(UNIT_RE, (_m, d, u) => { stats.nbsp++; return `${d} ${u}` })

  return t
}

/**
 * Run the same intra-run normalisation rules over a plain string (not XML). Used to
 * clean user-typed caption/source text in the interactive-input flow, so a hand-typed
 * caption gets the same deterministic treatment as the document body.
 */
export function normalizePlainText(text: string): string {
  return normalizeRunText(text, emptyStats())
}

// Matches a single <w:t> element: opening tag + pure-text content + closing tag.
// Content is always plain text — no child elements — so [^<]* is safe.
const WTEXT_RE = /(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/g

/**
 * Cross-run pass: within one paragraph, when a <w:t> ends with a space and the
 * immediately following <w:t> starts with sentence punctuation, trim that trailing
 * space. This catches the case where two adjacent runs produce "Hello ." even
 * though neither run individually contained a rule violation.
 */
function fixCrossRunSpacing(paraXml: string, stats: PunctStats): string {
  type Match = { start: number; len: number; open: string; text: string; close: string }
  const re = /(<w:t\b[^>]*>)([^<]*)(<\/w:t>)/g
  const matches: Match[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(paraXml)) !== null) {
    matches.push({ start: m.index, len: m[0].length, open: m[1], text: m[2], close: m[3] })
  }

  const toTrim = new Set<number>()
  for (let i = 0; i < matches.length - 1; i++) {
    if (matches[i].text.endsWith(' ') && /^[.,;:!?»]/.test(matches[i + 1].text)) {
      toTrim.add(i)
    }
  }
  if (toTrim.size === 0) return paraXml

  const parts: string[] = []
  let last = 0
  for (let i = 0; i < matches.length; i++) {
    const { start, len, open, text, close } = matches[i]
    parts.push(paraXml.slice(last, start))
    if (toTrim.has(i)) { stats.crossRunTrims++; parts.push(open + text.trimEnd() + close) }
    else parts.push(open + text + close)
    last = start + len
  }
  parts.push(paraXml.slice(last))
  return parts.join('')
}

/**
 * Deterministic punctuation normalisation for document.xml, returning the rewritten
 * XML plus per-rule counts.
 *
 * Pass 1 — per-run: normalise text content of every <w:t> node (double spaces, smart
 * quotes, space-before/after punctuation, em dash, ellipsis, unit non-breaking space).
 * Pass 2 — per-paragraph: trim trailing space from a <w:t> run when the next run in
 * the same paragraph starts with sentence punctuation.
 *
 * The AI receives clean text after this step, so it can focus on grammar.
 */
export function applyPunctNormWithStats(
  documentXml: string,
  stopAt = Infinity,
): { xml: string; stats: PunctStats } {
  const stats = emptyStats()

  // When a cutoff is set (appendix/annex), normalise only the blocks before it so the
  // frozen section keeps the author's punctuation. Block-scoped: rewrite each block's
  // <w:t> nodes (pass 1) + the cross-run fix for paragraphs (pass 2), then reassemble.
  if (Number.isFinite(stopAt)) {
    const blocks = getBlocks(documentXml)
    const byIndex = new Map<number, string>()
    blocks.forEach((b, i) => {
      if (i >= stopAt) return
      let nb = b.replace(WTEXT_RE, (_m, open: string, text: string, close: string) => open + normalizeRunText(text, stats) + close)
      if (isParagraph(nb)) nb = fixCrossRunSpacing(nb, stats)
      if (nb !== b) byIndex.set(i, nb)
    })
    return { xml: replaceBlocks(documentXml, byIndex), stats }
  }

  // Pass 1: intra-run normalization (whole document)
  let xml = documentXml.replace(
    WTEXT_RE,
    (_m, open: string, text: string, close: string) => open + normalizeRunText(text, stats) + close,
  )

  // Pass 2: cross-run space-before-punctuation, scoped to each paragraph
  xml = xml.replace(BLOCK_RE, block => (isParagraph(block) ? fixCrossRunSpacing(block, stats) : block))

  return { xml, stats }
}

/** Convenience wrapper that returns only the rewritten XML (back-compat). */
export function applyPunctNorm(documentXml: string): string {
  return applyPunctNormWithStats(documentXml).xml
}
