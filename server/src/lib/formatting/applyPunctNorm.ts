import { BLOCK_RE, isParagraph } from './blocks'

// Normalisation rules applied to each <w:t> text node in isolation.
const RULES: Array<(s: string) => string> = [
  // Collapse consecutive spaces into one
  s => s.replace(/ {2,}/g, ' '),
  // Remove space immediately before sentence punctuation
  s => s.replace(/ ([.,;:!?»])/g, '$1'),
  // Three-dot ellipsis → unicode ellipsis.
  // Both lookahead and lookbehind guard against matching the middle of a longer
  // run of dots (e.g. "...." must stay unchanged).
  s => s.replace(/(?<!\.)\.\.\.(?!\.)/g, '…'),
]

function normalizeRunText(text: string): string {
  return RULES.reduce((t, rule) => rule(t), text)
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
function fixCrossRunSpacing(paraXml: string): string {
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
    parts.push(toTrim.has(i) ? open + text.trimEnd() + close : open + text + close)
    last = start + len
  }
  parts.push(paraXml.slice(last))
  return parts.join('')
}

/**
 * Deterministic punctuation normalisation for document.xml.
 *
 * Pass 1 — per-run: normalise text content of every <w:t> node (double spaces,
 * space-before-punctuation, ellipsis).
 * Pass 2 — per-paragraph: trim trailing space from a <w:t> run when the next
 * run in the same paragraph starts with sentence punctuation.
 *
 * The AI receives clean text after this step, so it can focus on grammar.
 */
export function applyPunctNorm(documentXml: string): string {
  // Pass 1: intra-run normalization
  let xml = documentXml.replace(
    WTEXT_RE,
    (_m, open: string, text: string, close: string) => open + normalizeRunText(text) + close,
  )

  // Pass 2: cross-run space-before-punctuation, scoped to each paragraph
  xml = xml.replace(BLOCK_RE, block => (isParagraph(block) ? fixCrossRunSpacing(block) : block))

  return xml
}
