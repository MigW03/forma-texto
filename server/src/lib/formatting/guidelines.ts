/**
 * Guideline specs for the deterministic formatting passes.
 *
 * The single source of truth is `specs/{id}.md` (the §8 machine block), loaded
 * at runtime by `getGuideline()`. The `FALLBACK` table below is only a safety
 * net used when a guideline has no spec file yet (apa/mla/chicago) or its spec
 * fails to parse — it keeps jobs running. Edit the `.md` to change the rules.
 *
 * UNITS (OOXML / WordprocessingML):
 *  - Font size  -> half-points.  12pt = 24
 *  - Line space -> twentieths of a point, lineRule="auto".
 *                  240 = single, 360 = 1.5, 480 = double
 *  - Indent / margins -> twips.  1 inch = 1440 twips,  1 cm = 567 twips
 *      1.25cm first line = 709     0.5in = 720
 *      3cm = 1701   2cm = 1134     1in = 1440
 */

import { loadGuidelineFromSpec } from './loadGuideline'

export type Guideline = 'abnt' | 'apa' | 'mla' | 'chicago'

/** Paragraph alignment (w:jc value). ABNT justifies body text; APA/MLA/Chicago are left-aligned (ragged right). */
export type Align = 'both' | 'left'

export interface GuidelineSpec {
  body: { font: string; sz: number; line: number; firstLine: number; align: Align }
  heading: { font: string; sz: number; bold: boolean }
  margins: { top: number; bottom: number; left: number; right: number }
  /** References section (Step B) — entry layout. Heading uses REFERENCES_HEADING_STYLE. */
  references: {
    entryAlign: Align
    entryLine: number // line spacing (twentieths): 240 single, 480 double
    entryAfter: number // space after each entry (twentieths); creates the blank line between entries
    hangingIndent: number // twips; 0 = flush-left (ABNT), 720 = 0.5in hanging (APA/MLA/Chicago)
  }
}

/** Word styleId used for the references section heading (REFERÊNCIAS / References / ...). */
export const REFERENCES_HEADING_STYLE = 'ReferencesHeading'

/**
 * Built-in fallback values. Used only when `specs/{id}.md` is absent or invalid.
 * For guidelines that DO have a spec file (abnt), the `.md` wins via getGuideline().
 */
const FALLBACK: Record<Guideline, GuidelineSpec> = {
  abnt: {
    body: { font: 'Times New Roman', sz: 24, line: 360, firstLine: 709, align: 'both' }, // 1.5, 1.25cm, justified
    heading: { font: 'Times New Roman', sz: 24, bold: true }, // one font throughout — matches body (§2)
    margins: { top: 1701, bottom: 1134, left: 1701, right: 1134 }, // 3/2/3/2 cm
    references: { entryAlign: 'left', entryLine: 240, entryAfter: 240, hangingIndent: 0 }, // single, blank line between, flush-left
  },
  apa: {
    body: { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720, align: 'left' }, // double, 0.5in, ragged right
    heading: { font: 'Times New Roman', sz: 24, bold: true },
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 }, // 1in all
    references: { entryAlign: 'left', entryLine: 480, entryAfter: 0, hangingIndent: 720 }, // double, 0.5in hanging
  },
  mla: {
    body: { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720, align: 'left' },
    heading: { font: 'Times New Roman', sz: 24, bold: false },
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
    references: { entryAlign: 'left', entryLine: 480, entryAfter: 0, hangingIndent: 720 },
  },
  chicago: {
    body: { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720, align: 'left' },
    heading: { font: 'Times New Roman', sz: 24, bold: false },
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
    references: { entryAlign: 'left', entryLine: 240, entryAfter: 240, hangingIndent: 720 }, // single within, blank line between, 0.5in hanging
  },
}

/**
 * Resolve a guideline's deterministic formatting values.
 * Prefers the canonical `specs/{id}.md` spec; falls back to the built-in table
 * if the spec is missing or invalid (logged, so jobs never fail on a bad edit).
 */
export function getGuideline(id: Guideline): GuidelineSpec {
  try {
    return loadGuidelineFromSpec(id)
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn(`[guidelines] spec for "${id}" unavailable, using fallback: ${(err as Error).message}`)
    }
    return FALLBACK[id]
  }
}

/** Normalize whatever the projects table stores ("ABNT", "abnt", "APA 7th") to a key. */
export function resolveGuideline(raw: string | null | undefined): Guideline {
  const k = String(raw ?? 'abnt').toLowerCase()
  if (k.includes('abnt')) return 'abnt'
  if (k.includes('apa')) return 'apa'
  if (k.includes('mla')) return 'mla'
  if (k.includes('chicago')) return 'chicago'
  return 'abnt'
}
