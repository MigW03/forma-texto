// Builds a deliberately MIS-formatted academic .docx for testing Step A.
// Violations baked in: Arial throughout, single spacing, no first-line indent,
// chapter title styled as Normal (with hand-applied bold/size), default Word
// margins (1in / 1440 twips), direct font-size + font overrides on runs.
//
// Run from the server dir:  node test_assets/buildFixture.mjs
import { zipSync, strToU8 } from 'fflate'
import { writeFileSync } from 'node:fs'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

// VIOLATION: Normal = Arial 11pt, single spacing, no indent. No heading styles.
const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
</w:style>
</w:styles>`

// helpers to build paragraphs
const titleAsNormal = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="center"/></w:pPr>` +
  `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const body = (text) =>
  `<w:p><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr>` +
  `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>
${titleAsNormal('1 INTRODUÇÃO')}
${body('Este é um parágrafo de teste com fonte Arial, espaçamento simples e sem recuo de primeira linha. O objetivo é validar a Etapa A da formatação no servidor.')}
${body('Segundo parágrafo do corpo do texto, também com formatação incorreta aplicada diretamente nas runs em vez de via estilos nomeados.')}
${titleAsNormal('2 DESENVOLVIMENTO')}
${body('Terceiro parágrafo, sob um segundo título que também foi digitado como texto normal em negrito grande, simulando o erro mais comum dos usuários.')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`

const files = {
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rels),
  'word/_rels/document.xml.rels': strToU8(docRels),
  'word/document.xml': strToU8(documentXml),
  'word/styles.xml': strToU8(stylesXml),
}

writeFileSync(new URL('./formatting_test_input.docx', import.meta.url), zipSync(files))
console.log('wrote test_assets/formatting_test_input.docx')
