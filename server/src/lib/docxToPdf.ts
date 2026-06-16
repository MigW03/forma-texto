/**
 * DOCX → PDF conversion via a headless LibreOffice (`soffice`).
 *
 * LibreOffice is the only converter that renders the .docx with true Word
 * fidelity — ABNT margins, fonts and pagination come out exactly as the
 * deterministic pipeline laid them down, which a browser/HTML export can't match.
 *
 * Requirements (host/server): LibreOffice installed and `soffice` on PATH, or
 * `SOFFICE_PATH` pointing at the binary. macOS dev:
 *   brew install --cask libreoffice   # binary at /Applications/LibreOffice.app/Contents/MacOS/soffice
 *
 * Each call runs in its own temp dir with a private `UserInstallation` profile so
 * concurrent conversions don't fight over LibreOffice's shared lock file.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)

const SOFFICE = process.env.SOFFICE_PATH || 'soffice'
const CONVERT_TIMEOUT_MS = 120_000

/** Convert a .docx buffer to a PDF buffer. Throws if LibreOffice is missing or conversion fails. */
export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'ft-pdf-'))
  try {
    const inPath = join(dir, 'in.docx')
    const outPath = join(dir, 'in.pdf')
    await writeFile(inPath, docx)
    // Private profile dir → no shared-lock clash when jobs convert in parallel.
    const profileUrl = pathToFileURL(join(dir, 'profile')).href
    await execFileAsync(
      SOFFICE,
      [
        '--headless',
        '--norestore',
        '--nolockcheck',
        `-env:UserInstallation=${profileUrl}`,
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        dir,
        inPath,
      ],
      { timeout: CONVERT_TIMEOUT_MS },
    )
    return await readFile(outPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
