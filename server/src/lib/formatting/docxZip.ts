import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

const DOC_PATH = 'word/document.xml'
const STYLES_PATH = 'word/styles.xml'

export interface UnzippedDocx {
  /** All zip entries, kept verbatim so non-mutated parts survive the repack. */
  files: Record<string, Uint8Array>
  documentXml: string
  /** null when the DOCX ships without a styles part (rare/minimal files). */
  stylesXml: string | null
}

/** Unzip a .docx (or the .zip-renamed docx we store) into its XML parts. */
export function unzipDocx(buf: Uint8Array): UnzippedDocx {
  const files = unzipSync(buf)
  if (!files[DOC_PATH]) {
    throw new Error('Not a valid DOCX: word/document.xml missing')
  }
  return {
    files,
    documentXml: strFromU8(files[DOC_PATH]),
    stylesXml: files[STYLES_PATH] ? strFromU8(files[STYLES_PATH]) : null,
  }
}

/** Re-zip into a valid .docx, swapping in the (possibly mutated) XML parts. */
export function zipDocx(
  files: Record<string, Uint8Array>,
  parts: { documentXml: string; stylesXml: string | null },
): Buffer {
  const out: Record<string, Uint8Array> = { ...files }
  out[DOC_PATH] = strToU8(parts.documentXml)
  if (parts.stylesXml !== null) out[STYLES_PATH] = strToU8(parts.stylesXml)
  return Buffer.from(zipSync(out))
}
