import { Router, Request, Response } from 'express'

const router = Router()

const GDOC_PATTERN = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/

/**
 * Pull the document filename out of a Content-Disposition header. Google sends BOTH a plain
 * ASCII `filename="..."` (accents stripped) AND an RFC 5987 `filename*=UTF-8''...` (percent-
 * encoded, accents intact). We prefer the starred one so accented titles (Título, Educação…)
 * survive; the plain one is the fallback. Always returns a `.docx` name.
 */
export function filenameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const star = disposition.match(/filename\*=(?:UTF-8'')?["']?([^"';\r\n]+)/i)
  const plain = disposition.match(/filename=["']?([^"';\r\n]+)/i)
  let raw = star?.[1]?.trim()
  if (raw) {
    try { raw = decodeURIComponent(raw) } catch { /* keep raw if not valid %-encoding */ }
  } else {
    raw = plain?.[1]?.trim()
  }
  if (!raw) return fallback
  return raw.replace(/\.docx$/i, '') + '.docx'
}

// Extracts page count from a PDF binary. Finds all /Count N entries and takes
// the max, which is the root Pages node's total. Works reliably for Google Docs
// exports without requiring a full PDF parser.
function countPdfPages(buf: Buffer): number {
  const str = buf.toString('latin1')
  const counts: number[] = []
  for (const m of str.matchAll(/\/Count\s+(\d+)/g)) {
    counts.push(parseInt(m[1], 10))
  }
  return counts.length > 0 ? Math.max(...counts) : 0
}

router.get('/fetch', async (req: Request, res: Response) => {
  const { url } = req.query as { url?: string }

  if (!url) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  const match = url.match(GDOC_PATTERN)
  if (!match) {
    res.status(400).json({ error: 'Only Google Docs URLs are supported' })
    return
  }

  const docId = match[1]
  const docxUrl = `https://docs.google.com/document/d/${docId}/export?format=docx`
  const pdfUrl = `https://docs.google.com/document/d/${docId}/export?format=pdf`

  try {
    // Fetch DOCX and PDF in parallel; PDF gives us Google's authoritative page count.
    const [docxResp, pdfResp] = await Promise.all([
      fetch(docxUrl),
      fetch(pdfUrl).catch(() => null),
    ])

    if (!docxResp.ok) {
      res.status(400).json({ error: 'Could not fetch document. Make sure it is set to "anyone with the link can view".' })
      return
    }

    const [docxBuffer, pdfBuffer] = await Promise.all([
      docxResp.arrayBuffer(),
      pdfResp?.ok ? pdfResp.arrayBuffer() : Promise.resolve(null),
    ])

    const filename = filenameFromDisposition(
      docxResp.headers.get('content-disposition'),
      `document_${docId}.docx`,
    )

    // HTTP header values are latin-1, so a filename with accents (Título, Educação…) is
    // mangled/truncated if sent raw. Percent-encode X-Filename (the client decodeURIComponent's
    // it) and use RFC 5987 filename* for Content-Disposition, with an ASCII fallback.
    const encodedName = encodeURIComponent(filename)
    const asciiName = filename.replace(/[^\x20-\x7E]/g, '_')
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      'X-Filename': encodedName,
      'Access-Control-Expose-Headers': 'X-Filename, X-Page-Count',
    }

    if (pdfBuffer) {
      const pageCount = countPdfPages(Buffer.from(pdfBuffer))
      if (pageCount > 0) headers['X-Page-Count'] = String(pageCount)
    }

    res.set(headers)
    res.send(Buffer.from(docxBuffer))
  } catch {
    res.status(500).json({ error: 'Failed to fetch document' })
  }
})

export default router
