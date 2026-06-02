/**
 * CANONICAL GUIDELINE SPEC — single source of truth for all deterministic nodes.
 *
 * This file is documentation + a copy-paste source. n8n Code nodes cannot
 * `require` a local file, so each node inlines the GUIDELINES object below.
 * When a value changes here, update the inlined copy in every node file.
 *
 * UNITS (OOXML / WordprocessingML):
 *  - Font size  -> half-points.  12pt = 24
 *  - Line space -> twentieths of a point, lineRule="auto".
 *                  240 = single, 360 = 1.5, 480 = double
 *  - Indent / margins -> twips.  1 inch = 1440 twips,  1 cm = 567 twips
 *      1.25cm first line = 709     0.5in = 720
 *      3cm = 1701   2cm = 1134     1in = 1440
 *
 * Values below match the spec table in formattingPlan.md ("Body & layout").
 */

const GUIDELINES = {
  abnt: {
    body:    { font: 'Times New Roman', sz: 24, line: 360, firstLine: 709 }, // 1.5, 1.25cm
    heading: { font: 'Arial',           sz: 24, bold: true },
    margins: { top: 1701, bottom: 1134, left: 1701, right: 1134 },           // 3/2/3/2 cm
  },
  apa: {
    body:    { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720 }, // double, 0.5in
    heading: { font: 'Times New Roman', sz: 24, bold: true },
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },           // 1in all
  },
  mla: {
    body:    { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720 },
    heading: { font: 'Times New Roman', sz: 24, bold: false },
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
  },
  chicago: {
    body:    { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720 },
    heading: { font: 'Times New Roman', sz: 24, bold: false },
    margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
  },
};

// Normalize whatever the projects table stores ("ABNT", "abnt", "APA 7th"...) to a key.
function resolveGuideline(raw) {
  const k = String(raw || 'abnt').toLowerCase();
  if (k.includes('abnt')) return 'abnt';
  if (k.includes('apa')) return 'apa';
  if (k.includes('mla')) return 'mla';
  if (k.includes('chicago')) return 'chicago';
  return 'abnt';
}

module.exports = { GUIDELINES, resolveGuideline };
