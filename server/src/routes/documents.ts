import { Router, Request, Response } from 'express'

const router = Router()

const GDOC_PATTERN = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/

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

    // Try to extract filename from content-disposition
    let filename = `document_${docId}.docx`
    const disposition = docxResp.headers.get('content-disposition')
    if (disposition) {
      const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i)
      if (nameMatch) {
        filename = decodeURIComponent(nameMatch[1].trim()).replace(/\.docx$/i, '') + '.docx'
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Filename': filename,
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
