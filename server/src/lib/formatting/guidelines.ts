/**
 * Canonical guideline spec — single source of truth for the deterministic
 * formatting passes. Ported from n8nResources/nodes/_guidelines.js.
 *
 * UNITS (OOXML / WordprocessingML):
 *  - Font size  -> half-points.  12pt = 24
 *  - Line space -> twentieths of a point, lineRule="auto".
 *                  240 = single, 360 = 1.5, 480 = double
 *  - Indent / margins -> twips.  1 inch = 1440 twips,  1 cm = 567 twips
 *      1.25cm first line = 709     0.5in = 720
 *      3cm = 1701   2cm = 1134     1in = 1440
 */

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

export const GUIDELINES: Record<Guideline, GuidelineSpec> = {
  abnt: {
    body: { font: 'Times New Roman', sz: 24, line: 360, firstLine: 709, align: 'both' }, // 1.5, 1.25cm, justified
    heading: { font: 'Arial', sz: 24, bold: true },
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

/** Normalize whatever the projects table stores ("ABNT", "abnt", "APA 7th") to a key. */
export function resolveGuideline(raw: string | null | undefined): Guideline {
  const k = String(raw ?? 'abnt').toLowerCase()
  if (k.includes('abnt')) return 'abnt'
  if (k.includes('apa')) return 'apa'
  if (k.includes('mla')) return 'mla'
  if (k.includes('chicago')) return 'chicago'
  return 'abnt'
}
