// ============================================================================
// STEP 2.2 — STEP A: REWRITE styles.xml
// n8n Code node · mode: "Run Once for All Items"
//
// Strategy: do NOT surgically edit messy existing styles. Build known-good
// <w:style> blocks from the guideline spec and UPSERT them (replace if the
// styleId exists, insert before </w:styles> otherwise). Guarantees the same
// output regardless of how broken the source styles.xml is. Everything that
// is `basedOn` Normal then inherits our corrected base.
//
// In  json: { documentXml, stylesXml, guideline, ... }
// Out json: { ...same..., stylesXml: <rewritten> }
// ============================================================================

// --- inlined from _guidelines.js (keep in sync) -----------------------------
const GUIDELINES = {
  abnt:    { body: { font: 'Times New Roman', sz: 24, line: 360, firstLine: 709 }, heading: { font: 'Arial',           sz: 24, bold: true  }, margins: { top: 1701, bottom: 1134, left: 1701, right: 1134 } },
  apa:     { body: { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720 }, heading: { font: 'Times New Roman', sz: 24, bold: true  }, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  mla:     { body: { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720 }, heading: { font: 'Times New Roman', sz: 24, bold: false }, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
  chicago: { body: { font: 'Times New Roman', sz: 24, line: 480, firstLine: 720 }, heading: { font: 'Times New Roman', sz: 24, bold: false }, margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 } },
};
function resolveGuideline(raw) {
  const k = String(raw || 'abnt').toLowerCase();
  if (k.includes('abnt')) return 'abnt';
  if (k.includes('apa')) return 'apa';
  if (k.includes('mla')) return 'mla';
  if (k.includes('chicago')) return 'chicago';
  return 'abnt';
}
// ----------------------------------------------------------------------------

const EMPTY_STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '</w:styles>';

function normalBlock(g) {
  return (
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">' +
      '<w:name w:val="Normal"/>' +
      '<w:pPr>' +
        `<w:spacing w:after="0" w:line="${g.body.line}" w:lineRule="auto"/>` +
        `<w:ind w:firstLine="${g.body.firstLine}"/>` +
      '</w:pPr>' +
      '<w:rPr>' +
        `<w:rFonts w:ascii="${g.body.font}" w:hAnsi="${g.body.font}" w:cs="${g.body.font}"/>` +
        `<w:sz w:val="${g.body.sz}"/><w:szCs w:val="${g.body.sz}"/>` +
      '</w:rPr>' +
    '</w:style>'
  );
}

function headingBlock(g, level) {
  const names = ['heading 1', 'heading 2', 'heading 3'];
  const bold = g.heading.bold ? '<w:b/><w:bCs/>' : '';
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}">` +
      `<w:name w:val="${names[level - 1]}"/>` +
      '<w:basedOn w:val="Normal"/>' +
      '<w:next w:val="Normal"/>' +
      '<w:pPr>' +
        '<w:keepNext/><w:keepLines/>' +
        `<w:spacing w:before="240" w:after="120" w:line="${g.body.line}" w:lineRule="auto"/>` +
        '<w:ind w:firstLine="0"/>' +              // headings have no first-line indent
        `<w:outlineLvl w:val="${level - 1}"/>` +
      '</w:pPr>' +
      '<w:rPr>' +
        `<w:rFonts w:ascii="${g.heading.font}" w:hAnsi="${g.heading.font}" w:cs="${g.heading.font}"/>` +
        bold +
        `<w:sz w:val="${g.heading.sz}"/><w:szCs w:val="${g.heading.sz}"/>` +
      '</w:rPr>' +
    '</w:style>'
  );
}

// replace the <w:style> whose styleId matches, else insert before </w:styles>
function upsertStyle(xml, styleId, block) {
  const re = new RegExp(`<w:style\\b[^>]*\\bw:styleId="${styleId}"[\\s\\S]*?</w:style>`, 'i');
  if (re.test(xml)) return xml.replace(re, block);
  return xml.replace('</w:styles>', block + '</w:styles>');
}

// --- run --------------------------------------------------------------------
const input = $input.first().json;
const g = GUIDELINES[resolveGuideline(input.guideline)];

let stylesXml = input.stylesXml && input.stylesXml.includes('</w:styles>')
  ? input.stylesXml
  : EMPTY_STYLES;

stylesXml = upsertStyle(stylesXml, 'Normal', normalBlock(g));
stylesXml = upsertStyle(stylesXml, 'Heading1', headingBlock(g, 1));
stylesXml = upsertStyle(stylesXml, 'Heading2', headingBlock(g, 2));
stylesXml = upsertStyle(stylesXml, 'Heading3', headingBlock(g, 3));

return [{ json: { ...input, stylesXml } }];
