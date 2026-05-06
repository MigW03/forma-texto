import { useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
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
  const sorted = [...new Set(sizes)].sort((a, b) => b - a)
  const rank = sorted.indexOf(size)
  const bodySize = sorted[sorted.length - 1] ?? size
  if (size < bodySize * 0.85) return 'caption'
  if (rank === 0) return 'h1'
  if (rank === 1) return 'h2'
  if (rank === 2) return 'h3'
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

async function collectAllFontSizes(
  doc: pdfjsLib.PDFDocumentProxy,
  pages: number[]
): Promise<number[]> {
  const sizes = new Set<number>()
  await Promise.all(
    pages.map(async (p) => {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue
        const transform = item.transform as number[]
        const fontSize = Math.round((item.height || Math.abs(transform[3])) * 10) / 10
        sizes.add(fontSize)
      }
    })
  )
  return Array.from(sizes)
}

const BLOCK_STYLES: Record<BlockType, string> = {
  h1: 'text-2xl font-bold text-ink',
  h2: 'text-xl font-semibold text-ink',
  h3: 'text-lg font-medium text-ink',
  paragraph: 'text-sm text-ink leading-relaxed',
  caption: 'text-xs text-muted italic',
}

const BLOCK_LABELS: Record<BlockType, string> = {
  h1: 'H1', h2: 'H2', h3: 'H3', paragraph: 'P', caption: 'CAPTION',
}

const LABEL_COLORS: Record<BlockType, string> = {
  h1: 'bg-purple-100 text-purple-700',
  h2: 'bg-blue-100 text-blue-700',
  h3: 'bg-sky-100 text-sky-700',
  paragraph: 'bg-stone-100 text-stone-600',
  caption: 'bg-amber-50 text-amber-600',
}

export default function TextExtractPage() {
  const location = useLocation()
  const navigate = useNavigate()
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
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF extraction is supported for now.')
      setLoading(false)
      return
    }

    let cancelled = false
    let doc: pdfjsLib.PDFDocumentProxy | null = null

    ;(async () => {
      try {
        const buf = await file.arrayBuffer()
        if (cancelled) return
        doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
        if (cancelled) return

        const selectedPages = state?.selectedPages ?? []
        const allSizes = await collectAllFontSizes(doc, selectedPages)
        if (cancelled) return

        const results: PageContent[] = []
        for (const pageNum of selectedPages) {
          if (cancelled) break
          const blocks = await extractPageText(doc, pageNum, allSizes)
          results.push({ pageNumber: pageNum, blocks })
        }

        if (!cancelled) setPages(results)
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
    <div className="min-h-[calc(100vh-4rem)] bg-sand">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-6"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-ink mb-1">Text Extraction</h1>
              <p className="text-sm text-muted">
                {state.fileName} · {state.selectedPages?.length ?? 0} pages selected
              </p>
            </div>
            <span className="text-xs font-medium px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full border border-amber-200">
              DEV ONLY
            </span>
          </div>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 size={24} className="animate-spin text-forest" />
            <p className="text-sm text-muted">Extracting text from PDF…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && pages.map((pg) => (
          <div key={pg.pageNumber} className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium text-muted uppercase tracking-widest">
                Page {pg.pageNumber}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <div className="bg-white border border-border rounded-2xl px-8 py-8 flex flex-col gap-4">
              {pg.blocks.length === 0 && (
                <p className="text-sm text-muted italic">No text content found on this page.</p>
              )}
              {pg.blocks.map((block, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5 font-mono ${LABEL_COLORS[block.type]}`}>
                    {BLOCK_LABELS[block.type]}
                  </span>
                  <p className={BLOCK_STYLES[block.type]}>{block.text}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
