import { Router, Request, Response } from 'express'

const router = Router()

const GDOC_PATTERN = /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/

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

  const exportUrl = `https://docs.google.com/document/d/${match[1]}/export?format=docx`

  try {
    const response = await fetch(exportUrl)
    if (!response.ok) {
      res.status(400).json({ error: 'Could not fetch document. Make sure it is set to "anyone with the link can view".' })
      return
    }

    const buffer = await response.arrayBuffer()

    // Try to extract filename from content-disposition
    let filename = `document_${match[1]}.docx`
    const disposition = response.headers.get('content-disposition')
    if (disposition) {
      const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i)
      if (nameMatch) {
        filename = decodeURIComponent(nameMatch[1].trim()).replace(/\.docx$/i, '') + '.docx'
      }
    }

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Filename': filename,
      'Access-Control-Expose-Headers': 'X-Filename',
    })
    res.send(Buffer.from(buffer))
  } catch {
    res.status(500).json({ error: 'Failed to fetch document' })
  }
})

export default router
