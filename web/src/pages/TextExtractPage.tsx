import { useState, useEffect } from 'react'
import { useLocation, Link } from 'react-router-dom'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import { unzipSync } from 'fflate'
import { ROUTES } from '../lib/routes'
import { getStoredFile } from '../lib/file-store'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'caption'

interface TextBlock {
  type: BlockType
  text: string
  fontSize: number
}

interface PageContent {
  pageNumber: number
  blocks: TextBlock[]
}

function classifyFontSize(size: number, sizes: number[]): BlockType {
  if (sizes.length === 0 || size <= 0) return 'paragraph'
  // Body = most frequent size; fall back to smallest if tie
  const freq: Record<number, number> = {}
  for (const s of sizes) freq[s] = (freq[s] ?? 0) + 1
  const bodySize = Number(
    Object.entries(freq).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]
  )
  const ratio = size / bodySize
  if (ratio < 0.85) return 'caption'
  if (ratio >= 1.6) return 'h1'
  if (ratio >= 1.3) return 'h2'
  if (ratio >= 1.1) return 'h3'
  return 'paragraph'
}

async function extractPageText(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  allFontSizes: number[]
): Promise<TextBlock[]> {
  const page = await doc.getPage(pageNumber)
  const content = await page.getTextContent()

  type LineGroup = { y: number; fontSize: number; texts: string[] }
  const lines: LineGroup[] = []

  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const transform = item.transform as number[]
    const fontSize = Math.round((item.height || Math.abs(transform[3])) * 10) / 10
    const y = Math.round(transform[5] / 2) * 2

    const existing = lines.find(l => Math.abs(l.y - y) <= 2)
    if (existing) {
      existing.texts.push(item.str)
      existing.fontSize = Math.max(existing.fontSize, fontSize)
    } else {
      lines.push({ y, fontSize, texts: [item.str] })
    }
  }

  lines.sort((a, b) => b.y - a.y)

  const blocks: TextBlock[] = []
  let current: { fontSize: number; parts: string[] } | null = null

  for (const line of lines) {
    const text = line.texts.join(' ').trim()
    if (!text) continue
    if (current && Math.abs(current.fontSize - line.fontSize) < 0.5) {
      current.parts.push(text)
    } else {
      if (current) {
        blocks.push({
          type: classifyFontSize(current.fontSize, allFontSizes),
          text: current.parts.join(' '),
          fontSize: current.fontSize,
        })
      }
      current = { fontSize: line.fontSize, parts: [text] }
    }
  }
  if (current) {
    blocks.push({
      type: classifyFontSize(current.fontSize, allFontSizes),
      text: current.parts.join(' '),
      fontSize: current.fontSize,
    })
  }

  return blocks
}

function parseXml(xmlStr: string): Document {
  return new DOMParser().parseFromString(xmlStr, 'application/xml')
}

function attr(el: Element, ns: string, name: string): string {
  return el.getAttributeNS(ns, name) ?? el.getAttribute(`w:${name}`) ?? ''
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

// Heading style IDs used by Word (EN + PT variants)
const HEADING_STYLE_RE = /^(heading|título|Heading|h)[_ -]?([1-6])$/i

function resolveHeadingLevel(styleId: string): number | null {
  const m = styleId.match(HEADING_STYLE_RE)
  return m ? parseInt(m[2]) : null
}

async function extractDocxText(file: File): Promise<PageContent[]> {
  const buf = await file.arrayBuffer()
  const zip = unzipSync(new Uint8Array(buf))

  const decoder = new TextDecoder()
  const docXml = parseXml(decoder.decode(zip['word/document.xml']))
  const stylesXml = zip['word/styles.xml']
    ? parseXml(decoder.decode(zip['word/styles.xml']))
    : null

  // Build map: styleId → base font size (half-points) from styles.xml
  const styleFontSize: Record<string, number> = {}
  const styleHeadingLevel: Record<string, number> = {}
  if (stylesXml) {
    for (const style of Array.from(stylesXml.getElementsByTagNameNS(W, 'style'))) {
      const idEl = style.getElementsByTagNameNS(W, 'styleId')[0]
      const id = attr(style, W, 'styleId') || idEl?.textContent || ''
      const lvl = resolveHeadingLevel(id)
      if (lvl) styleHeadingLevel[id] = lvl

      const szEl = style.getElementsByTagNameNS(W, 'sz')[0]
      if (szEl) {
        const sz = parseInt(attr(szEl, W, 'val') || szEl.getAttribute('w:val') || '0')
        if (sz > 0) styleFontSize[id] = sz / 2 // half-points → points
      }
    }
  }

  // Extract paragraphs with text + effective font size
  const paragraphs: { text: string; fontSize: number; headingLevel: number | null }[] = []
  const allSizes: number[] = []

  for (const para of Array.from(docXml.getElementsByTagNameNS(W, 'p'))) {
    // Collect all text runs
    const text = Array.from(para.getElementsByTagNameNS(W, 't'))
      .map(t => t.textContent ?? '')
      .join('')
      .trim()
    if (!text) continue

    // Style ID → heading level from styles.xml
    const pStyleEl = para.querySelector('[*|val]')
    const pPr = para.getElementsByTagNameNS(W, 'pPr')[0]
    const pStyleId = pPr
      ? (pPr.getElementsByTagNameNS(W, 'pStyle')[0]
          ?.getAttribute('w:val') ?? '')
      : ''
    const headingLevel = resolveHeadingLevel(pStyleId) ?? null

    // Effective font size: run-level override → style default → 0
    let fontSize = 0
    const runSizes: number[] = []
    for (const run of Array.from(para.getElementsByTagNameNS(W, 'r'))) {
      const szEl = run.getElementsByTagNameNS(W, 'sz')[0]
      if (szEl) {
        const val = parseInt(szEl.getAttribute('w:val') ?? '0')
        if (val > 0) runSizes.push(val / 2)
      }
    }
    if (runSizes.length > 0) {
      fontSize = Math.max(...runSizes)
    } else if (pStyleId && styleFontSize[pStyleId]) {
      fontSize = styleFontSize[pStyleId]
    }

    paragraphs.push({ text, fontSize, headingLevel })
    if (fontSize > 0) allSizes.push(fontSize)
  }

  // Font-size based classification (fallback when no heading style)
  const classifySize = (size: number): BlockType => classifyFontSize(size, allSizes)

  const headingLevelToType: Record<number, BlockType> = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h3', 5: 'h3', 6: 'h3' }

  const blocks: TextBlock[] = paragraphs.map(p => ({
    type: p.headingLevel != null
      ? headingLevelToType[p.headingLevel]
      : classifySize(p.fontSize),
    text: p.text,
    fontSize: p.fontSize,
  }))

  // Split into virtual pages (~40 blocks each)
  const BLOCKS_PER_PAGE = 40
  const pages: PageContent[] = []
  for (let i = 0; i < blocks.length; i += BLOCKS_PER_PAGE) {
    pages.push({ pageNumber: pages.length + 1, blocks: blocks.slice(i, i + BLOCKS_PER_PAGE) })
  }
  if (pages.length === 0) pages.push({ pageNumber: 1, blocks: [] })
  return pages
}

async function collectAllFontSizes(
  doc: pdfjsLib.PDFDocumentProxy,
  pages: number[]
): Promise<number[]> {
  const allSizes: number[][] = await Promise.all(
    pages.map(async (p) => {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const sizes: number[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const transform = item.transform as number[]
        const fontSize = Math.round((item.height || Math.abs(transform[3])) * 10) / 10
        if (fontSize > 0) sizes.push(fontSize)
      }
      return sizes
    })
  )
  return allSizes.flat()
}

export default function TextExtractPage() {
  const location = useLocation()
  const state = location.state as {
    fileName: string
    selectedPages: number[]
  } | null

  const file = getStoredFile()

  const [pages, setPages] = useState<PageContent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file) {
      setError('No file found. Please go back and try again.')
      setLoading(false)
      return
    }

    const name = file.name.toLowerCase()
    const isDocx = name.endsWith('.docx') || name.endsWith('.doc')
    const isPdf = name.endsWith('.pdf')

    if (!isPdf && !isDocx) {
      setError('Unsupported file type. Please use a PDF or Word document.')
      setLoading(false)
      return
    }

    let cancelled = false
    let doc: pdfjsLib.PDFDocumentProxy | null = null

    ;(async () => {
      try {
        if (isDocx) {
          const results = await extractDocxText(file)
          if (!cancelled) setPages(results)
        } else {
          const buf = await file.arrayBuffer()
          if (cancelled) return
          doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
          if (cancelled) return

          const selectedPages = (state?.selectedPages ?? [])
            .filter(p => p >= 1 && p <= doc!.numPages)
          const allSizes = await collectAllFontSizes(doc, selectedPages)
          if (cancelled) return

          const results: PageContent[] = []
          for (const pageNum of selectedPages) {
            if (cancelled) break
            const blocks = await extractPageText(doc, pageNum, allSizes)
            results.push({ pageNumber: pageNum, blocks })
          }

          if (!cancelled) setPages(results)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      doc?.destroy()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!state) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted mb-4">No document found.</p>
          <Link to={ROUTES.getStarted} className="text-sm text-ink underline">Go back</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-border p-10 w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">Checkout</h1>
        <p className="text-sm text-muted">Payment UI coming soon.</p>
      </div>
    </div>
  )
}
