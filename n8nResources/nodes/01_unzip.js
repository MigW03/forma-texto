// ============================================================================
// STEP 2.1 — UNZIP & EXTRACT
// n8n Code node · mode: "Run Once for All Items"
// Requires: fflate in NODE_FUNCTION_ALLOW_EXTERNAL
//
// Upstream chain expected:
//   Webhook ({ projectId })
//     -> "Get Project" (Supabase: row with guideline, services, original_file_path)
//     -> "Download DOCX" (Supabase Storage / HTTP Request -> binary on property "data")
//     -> THIS NODE
//
// Output json: { documentXml, stylesXml, guideline }
// NOTE: we do NOT carry the rest of the zip forward (images etc. can be large).
//       Step E (repack) reaches back to "Download DOCX" for the original binary,
//       unzips it fresh, and swaps in only the mutated document.xml / styles.xml.
// ============================================================================

const { unzipSync, strFromU8 } = require('fflate');

// original .docx binary from the download node (binary property name = "data")
const buffer = await this.helpers.getBinaryDataBuffer(0, 'data');
const zip = unzipSync(new Uint8Array(buffer));

if (!zip['word/document.xml']) {
  throw new Error('Not a valid DOCX: word/document.xml missing');
}

const documentXml = strFromU8(zip['word/document.xml']);
const stylesXml = zip['word/styles.xml'] ? strFromU8(zip['word/styles.xml']) : null;

// guideline travels from the project row fetched earlier
const guideline = $('Get Project').first().json.guideline || 'abnt';

return [{ json: { documentXml, stylesXml, guideline } }];
