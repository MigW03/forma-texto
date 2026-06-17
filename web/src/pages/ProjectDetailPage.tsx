import { useState, useEffect, useRef, useCallback, createPortal } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileText, Download, Trash2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderAsync } from 'docx-preview'
import { ROUTES } from '../lib/routes'
import { supabase } from '../lib/supabase'
import { calcPrice, formatBRL } from '../lib/pricing'
import type { ServiceKey } from '../lib/pricing'
import { formatPageRanges } from '../lib/format'
import { normalizeStatus, STATUS_BADGE_VARIANT } from '../lib/status'
import type { GuidelineId } from '../lib/guidelines'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface PendingInputFE {
  id: string
  kind: 'figure-caption' | 'figure-source' | 'table-caption' | 'table-source'
  ordinal: number
  insertedAt: number
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface ProjectDetail {
  id: string
  title: string | null
  original_file_name: string
  original_file_path: string | null
  processed_file_path: string | null
  references_pages: number[] | null
  services: ServiceKey[]
  guideline: GuidelineId | null
  status: string
  page_count: number
  selected_pages: number[] | null
  created_at: string
  pending_inputs: PendingInputFE[] | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

// ── PDF page component ───────────────────────────────────────────────────────

function PdfPage({
  doc,
  pageNum,
  containerWidth,
  label,
}: {
  doc: pdfjsLib.PDFDocumentProxy
  pageNum: number
  containerWidth: number
  label?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [height, setHeight] = useState(842) // A4 fallback
  const [rendered, setRendered] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setVisible(true) },
      { rootMargin: '400px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || containerWidth === 0) return
    setRendered(false)
    let cancelled = false
    let renderTask: pdfjsLib.RenderTask | null = null

    ;(async () => {
      try {
        const page = await doc.getPage(pageNum)
        const naturalVp = page.getViewport({ scale: 1 })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const cssScale = containerWidth / naturalVp.width
        const renderScale = cssScale * dpr
        const renderViewport = page.getViewport({ scale: renderScale })
        const cssViewport = page.getViewport({ scale: cssScale })

        if (cancelled) return
        setHeight(cssViewport.height)

        const canvas = canvasRef.current
        const textDiv = textRef.current
        if (!canvas || !textDiv) return

        canvas.width = Math.round(renderViewport.width)
        canvas.height = Math.round(renderViewport.height)
        canvas.style.width = `${containerWidth}px`
        canvas.style.height = 'auto'

        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext('2d')!,
          viewport: renderViewport,
        })
        await renderTask.promise

        if (cancelled) return
        setRendered(true)

        textDiv.style.width = `${cssViewport.width}px`
        textDiv.style.height = `${cssViewport.height}px`

        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport: cssViewport,
        })
        await textLayer.render()
      } catch {
        // cancelled or render error
      }
    })()

    return () => { cancelled = true; renderTask?.cancel() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, containerWidth])

  return (
    <div ref={wrapRef} style={{ minHeight: height }}>
      <p className="text-sm font-medium text-muted/80 mb-1.5 pl-0.5">{label ?? pageNum}</p>
      <div className="relative bg-white rounded-xl shadow-sm overflow-hidden">
        {!rendered && (
          <div
            className="absolute inset-0 bg-white rounded-xl animate-pulse z-10"
            style={{ width: containerWidth, height }}
          />
        )}
        <canvas ref={canvasRef} className="block" />
        <div ref={textRef} className="pdf-text-layer" />
      </div>
    </div>
  )
}

// ── PDF viewer ───────────────────────────────────────────────────────────────

const ZOOM_STEP = 0.15
const ZOOM_MIN = 0.4
const ZOOM_MAX = 2.5
const ZOOM_DEFAULT = 0.65

// ── Zoom controls ────────────────────────────────────────────────────────────

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const [zoomInput, setZoomInput] = useState(String(Math.round(zoom * 100)))

  useEffect(() => {
    setZoomInput(String(Math.round(zoom * 100)))
  }, [zoom])

  const applyZoom = (raw: string) => {
    const n = parseInt(raw, 10)
    if (!isNaN(n)) {
      const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n / 100))
      setZoom(parseFloat(clamped.toFixed(2)))
      setZoomInput(String(Math.round(clamped * 100)))
    } else {
      setZoomInput(String(Math.round(zoom * 100)))
    }
  }

  return (
    <div className="inline-flex items-center gap-1 bg-white border border-border rounded-xl px-2 py-1.5 shadow-sm">
      <button
        onClick={() => setZoom(Math.max(ZOOM_MIN, parseFloat((zoom - ZOOM_STEP).toFixed(2))))}
        className="w-6 h-6 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-[#F0EEE8] transition-colors text-base font-medium"
        aria-label="Zoom out"
      >−</button>
      <input
        type="text"
        inputMode="numeric"
        value={zoomInput}
        onChange={e => setZoomInput(e.target.value)}
        onBlur={() => applyZoom(zoomInput)}
        onKeyDown={e => { if (e.key === 'Enter') { applyZoom(zoomInput); (e.target as HTMLInputElement).blur() } }}
        className="text-xs font-medium text-ink w-9 text-center tabular-nums bg-transparent border-none outline-none focus:bg-[#F0EEE8] rounded focus:px-0.5 transition-colors"
        aria-label="Zoom level"
      />
      <span className="text-xs text-muted">%</span>
      <button
        onClick={() => setZoom(Math.min(ZOOM_MAX, parseFloat((zoom + ZOOM_STEP).toFixed(2))))}
        className="w-6 h-6 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-[#F0EEE8] transition-colors text-base font-medium"
        aria-label="Zoom in"
      >+</button>
    </div>
  )
}

// ── Preview error fallback ───────────────────────────────────────────────────

// Shown when a file can't be rendered (corrupt/invalid XML, decode failure, …)
// so the pane never goes silently blank — the user still gets a download path.
function PreviewError({ url, fileName }: { url: string; fileName: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-white border border-border flex items-center justify-center">
        <FileText size={24} className="text-muted" strokeWidth={1.5} />
      </div>
      <p className="text-sm text-muted max-w-xs">{t('project.previewError')}</p>
      <Button asChild variant="outline">
        <a href={url} download={fileName}>
          <Download size={14} />
          {t('project.downloadFile')}
        </a>
      </Button>
    </div>
  )
}

// ── PDF viewer ───────────────────────────────────────────────────────────────

function PdfViewer({
  url,
  fileName,
  selectedPages,
  pageCount,
  zoom,
}: {
  url: string
  fileName: string
  selectedPages: number[]
  pageCount: number
  zoom: number
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [loadError, setLoadError] = useState(false)

  const measureWidth = useCallback(() => {
    if (outerRef.current) {
      setContainerWidth(outerRef.current.clientWidth - 64)
    }
  }, [])

  useEffect(() => {
    measureWidth()
    const obs = new ResizeObserver(measureWidth)
    if (outerRef.current) obs.observe(outerRef.current)
    return () => obs.disconnect()
  }, [measureWidth])

  useEffect(() => {
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null
    pdfjsLib.getDocument({ url }).promise
      .then((d) => { pdfDoc = d; setDoc(d) })
      .catch(() => setLoadError(true))
    return () => { pdfDoc?.destroy() }
  }, [url])

  if (loadError) return <PreviewError url={url} fileName={fileName} />

  const pageWidth = containerWidth * zoom

  // The stored file is sliced to the selected pages in ascending order, so each
  // selected page maps to its position within that file. (References live inline
  // in this single file.) Falls back to a sequential 1..pageCount for old records
  // without selected_pages.
  const displayOrder = selectedPages.length > 0
    ? [...selectedPages].sort((a, b) => a - b)
    : Array.from({ length: pageCount }, (_, i) => i + 1)
  const pageMap = new Map(displayOrder.map((p, i) => [p, i + 1]))

  return (
    <div ref={outerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative">
      <div className="flex flex-col items-center gap-6 py-4 pb-8 min-w-fit px-8">
        {pageWidth > 0
          ? displayOrder.map((origPage, displayIdx) => {
              const pageNum = pageMap.get(origPage)!
              if (!doc) {
                return (
                  <div key={origPage} className="bg-white rounded-xl shadow-sm animate-pulse"
                    style={{ width: pageWidth, height: pageWidth * 1.414 }} />
                )
              }
              return (
                <PdfPage key={origPage} doc={doc} pageNum={pageNum} containerWidth={pageWidth} label={displayIdx + 1} />
              )
            })
          : Array.from({ length: Math.min(selectedPages.length, 3) }, (_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm animate-pulse"
                style={{ width: 500, height: 500 * 1.414 }} />
            ))
        }
      </div>
    </div>
  )
}

// ── DOCX viewer ──────────────────────────────────────────────────────────────

const DOCX_ZOOM_DEFAULT = 0.9

const DOCX_RENDER_OPTIONS = {
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  experimental: true,
  renderHeaders: true,
  renderFooters: true,
}

const DOCX_PAGE_STYLES = `
  /* Reset the page counter on the body container, NOT on .docx-wrapper:
     docx-preview puts its list-numbering counter-reset on .docx-wrapper, and
     counter-reset is a single non-merging property — setting it here too would
     clobber the list counters and make every list item render as "1". */
  .docx-body { counter-reset: docx-page; }
  .docx-wrapper {
    background: #E8E6DF !important;
    padding: 32px !important;
    padding-bottom: 8px !important;
    /* shrink to the widest page so align-self:stretch sizes the divider to the
       page width (not the full viewport) — keeps it centered via auto margins */
    width: fit-content !important;
    min-width: min-content !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  .docx-wrapper > section.docx {
    counter-increment: docx-page;
    border-radius: 12px !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06) !important;
    margin-top: 22px !important;
    margin-bottom: 24px !important;
    position: relative !important;
    overflow: visible !important;
  }
  .docx-wrapper > section.docx::before {
    content: counter(docx-page);
    position: absolute;
    top: -20px;
    left: 2px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(26, 26, 24, 0.6);
    line-height: 1.2;
  }
  .docx-page-break-divider {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 4px;
    margin: 6px 0;
    pointer-events: none;
    user-select: none;
  }
  .docx-page-break-line {
    flex: 1 1 auto;
    height: 0;
    border-top: 2px dashed rgba(26, 26, 24, 0.30);
  }
  .docx-page-break-label {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(26, 60, 46, 0.08);
    border: 1px solid rgba(26, 60, 46, 0.20);
    color: #1A3C2E;
    font-size: 13px;
    font-weight: 600;
    font-family: Inter, -apple-system, system-ui, sans-serif;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 5px 12px;
    border-radius: 9999px;
    white-space: nowrap;
  }
`

function DocxViewer({
  url,
  fileName,
  zoom,
  pageBreakLabel,
  onRendered,
  children,
}: {
  url: string
  fileName: string
  zoom: number
  pageBreakLabel: string
  onRendered?: (bodyEl: HTMLElement, outerEl: HTMLElement) => void
  children?: React.ReactNode
}) {
  const outerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)
  const onRenderedRef = useRef(onRendered)
  onRenderedRef.current = onRendered

  useEffect(() => {
    const body = bodyRef.current
    const style = styleRef.current
    if (!body || !style) return
    // Clear any prior render and guard against StrictMode's double-invoke (which
    // otherwise races two renderAsync chains and inserts the dividers twice).
    let cancelled = false
    body.replaceChildren()
    style.replaceChildren()
    setLoading(true)
    fetch(url)
      .then(r => r.blob())
      .then(blob => renderAsync(blob, body, style, DOCX_RENDER_OPTIONS))
      .then(() => {
        if (cancelled) return
        body.querySelectorAll('section.docx').forEach((section) => {
          if ((section as HTMLElement).innerText.trim() === '') section.remove()
        })
        // Insert "Page break" dividers between sections — a dashed rule on each
        // side of a badge label, so the gap reads as an intentional break.
        const sections = Array.from(body.querySelectorAll('section.docx'))
        sections.slice(0, -1).forEach((section) => {
          const divider = document.createElement('div')
          divider.className = 'docx-page-break-divider'
          const lineL = document.createElement('span')
          lineL.className = 'docx-page-break-line'
          const label = document.createElement('span')
          label.className = 'docx-page-break-label'
          label.textContent = `✂ ${pageBreakLabel}`
          const lineR = document.createElement('span')
          lineR.className = 'docx-page-break-line'
          divider.append(lineL, label, lineR)
          section.after(divider)
        })
        const override = document.createElement('style')
        override.textContent = DOCX_PAGE_STYLES
        style.appendChild(override)
        setLoading(false)
        if (outerRef.current && bodyRef.current) {
          // Settle layout before scanning placeholder positions
          requestAnimationFrame(() => {
            if (!cancelled && outerRef.current && bodyRef.current) {
              onRenderedRef.current?.(bodyRef.current, outerRef.current)
            }
          })
        }
      })
      .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [url, pageBreakLabel])

  if (loadError) return <PreviewError url={url} fileName={fileName} />

  return (
    <div ref={outerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative bg-[#E8E6DF]">
      {loading && (
        <div className="flex flex-col items-center gap-6 py-8 px-8">
          {[0, 1].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-sm animate-pulse" style={{ width: 595, height: 842 }} />
          ))}
        </div>
      )}
      <div style={{ zoom, display: loading ? 'none' : undefined }}>
        <div ref={styleRef} />
        <div ref={bodyRef} className="docx-body" />
      </div>
      {children}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

/**
 * The pipeline stores the PDF export beside the processed .docx at the same path
 * with a .pdf extension (see server `processFormatting`). Returns null when the
 * processed path isn't a .docx (so we never request a nonsensical signed URL).
 */
function pdfPathFor(processedPath: string | null | undefined): string | null {
  if (!processedPath || !/\.docx$/i.test(processedPath)) return null
  return processedPath.replace(/\.docx$/i, '.pdf')
}

export default function ProjectDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [processedFileUrl, setProcessedFileUrl] = useState<string | null>(null)
  const [processedPdfUrl, setProcessedPdfUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const viewerWrapRef = useRef<HTMLDivElement>(null)

  // needs_input state
  const [pendingInputs, setPendingInputs] = useState<PendingInputFE[]>([])
  const [fills, setFills] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<PendingInputFE | null>(null)
  const [removeConfirming, setRemoveConfirming] = useState(false)
  const [overlayPositions, setOverlayPositions] = useState<{ id: string; top: number }[]>([])
  const docxBodyRef = useRef<HTMLElement | null>(null)
  const docxOuterRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!id) return
    supabase
      .from('projects')
      .select('id, title, original_file_name, original_file_path, processed_file_path, references_pages, selected_pages, services, guideline, status, page_count, created_at, pending_inputs')
      .eq('id', id)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setProject(data as ProjectDetail)
        if (data.pending_inputs) setPendingInputs(data.pending_inputs as PendingInputFE[])
        setZoom(data.original_file_name.toLowerCase().endsWith('.docx') ? DOCX_ZOOM_DEFAULT : ZOOM_DEFAULT)
        const pdfPath = pdfPathFor(data.processed_file_path)
        const canSee = data.processed_file_path && (data.status === 'complete' || data.status === 'needs_input')
        const [origSigned, procSigned, pdfSigned] = await Promise.all([
          data.original_file_path
            ? supabase.storage.from('projects').createSignedUrl(data.original_file_path, 3600)
            : Promise.resolve({ data: null }),
          canSee
            ? supabase.storage.from('projects').createSignedUrl(data.processed_file_path!, 3600)
            : Promise.resolve({ data: null }),
          // The PDF export may be absent (older projects, or LibreOffice failed) —
          // a missing object just errors and we leave the button hidden.
          pdfPath && data.status === 'complete'
            ? supabase.storage.from('projects').createSignedUrl(pdfPath, 3600)
            : Promise.resolve({ data: null }),
        ])
        if (origSigned.data?.signedUrl) setFileUrl(origSigned.data.signedUrl)
        if (procSigned.data?.signedUrl) setProcessedFileUrl(procSigned.data.signedUrl)
        if (pdfSigned.data?.signedUrl) setProcessedPdfUrl(pdfSigned.data.signedUrl)
        setLoading(false)
      })
  }, [id])

  useEffect(() => {
    const el = viewerWrapRef.current
    if (!el) return
    const onScroll = (e: Event) => setScrolled((e.target as HTMLElement).scrollTop > 0)
    el.addEventListener('scroll', onScroll, { capture: true })
    return () => el.removeEventListener('scroll', onScroll, { capture: true })
  }, [loading])

  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`project:${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${id}` },
        async (payload) => {
          const updated = payload.new as ProjectDetail & { pending_inputs?: PendingInputFE[] }
          setProject((prev) => prev ? {
            ...prev,
            status: updated.status,
            processed_file_path: updated.processed_file_path,
            pending_inputs: updated.pending_inputs ?? null,
          } : prev)
          if (updated.pending_inputs) {
            setPendingInputs(updated.pending_inputs)
          } else if (updated.status === 'complete') {
            setPendingInputs([])
          }
          if (updated.processed_file_path && (updated.status === 'complete' || updated.status === 'needs_input')) {
            const pdfPath = updated.status === 'complete' ? pdfPathFor(updated.processed_file_path) : null
            const [proc, pdf] = await Promise.all([
              supabase.storage.from('projects').createSignedUrl(updated.processed_file_path, 3600),
              pdfPath
                ? supabase.storage.from('projects').createSignedUrl(pdfPath, 3600)
                : Promise.resolve({ data: null }),
            ])
            if (proc.data?.signedUrl) setProcessedFileUrl(proc.data.signedUrl)
            if (pdf.data?.signedUrl) setProcessedPdfUrl(pdf.data.signedUrl)
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  if (loading) {
    return (
      <div className="flex h-[calc(100vh-4rem)]">
        <div className="flex-1 bg-[#E8E6DF] animate-pulse" />
        <div className="w-80 border-l border-border bg-white animate-pulse" />
      </div>
    )
  }

  if (notFound || !project) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center">
          <p className="text-sm text-muted mb-4">{t('project.notFound')}</p>
          <Link to={ROUTES.dashboard} className="text-sm font-medium text-ink underline underline-offset-2">
            {t('project.backToDashboard')}
          </Link>
        </div>
      </div>
    )
  }

  const status = normalizeStatus(project.status)
  const nameLower = project.original_file_name.toLowerCase()
  const isPdf = nameLower.endsWith('.pdf')
  const isDocx = nameLower.endsWith('.docx')
  const totalCost = project.services.reduce((sum, s) => sum + calcPrice(s, project.page_count), 0)
  const canSeeProcessed = !!processedFileUrl && (status === 'complete' || status === 'needs_input')
  const canDownloadProcessed = !!processedFileUrl && status === 'complete'
  const previewUrl = canSeeProcessed ? processedFileUrl : fileUrl
  const pdfDownloadName = project.original_file_name.replace(/\.docx$/i, '') + '.pdf'
  const selectedPages = project.selected_pages ?? []
  const referencesPages = project.references_pages ?? []

  const scanPlaceholders = useCallback(() => {
    const body = docxBodyRef.current
    const outer = docxOuterRef.current
    if (!body || !outer || pendingInputs.length === 0) return
    const outerRect = outer.getBoundingClientRect()
    const scrollTop = outer.scrollTop

    const matched: { top: number }[] = []
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      if ((node.textContent ?? '').includes('[inserir')) {
        const el = node.parentElement
        if (el) {
          const rect = el.getBoundingClientRect()
          matched.push({ top: rect.top - outerRect.top + scrollTop })
        }
      }
    }
    const sortedPending = [...pendingInputs].sort((a, b) => a.insertedAt - b.insertedAt)
    const positions = sortedPending.map((p, i) =>
      matched[i] ? { id: p.id, top: matched[i].top } : null
    ).filter(Boolean) as { id: string; top: number }[]
    setOverlayPositions(positions)
  }, [pendingInputs])

  const handleDocxRendered = useCallback((bodyEl: HTMLElement, outerEl: HTMLElement) => {
    docxBodyRef.current = bodyEl
    docxOuterRef.current = outerEl
    setTimeout(scanPlaceholders, 50)
  }, [scanPlaceholders])

  useEffect(() => { scanPlaceholders() }, [scanPlaceholders])

  const callFillApi = useCallback(async (payload: { fills?: Record<string, string>; removals?: string[] }) => {
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`${apiUrl}/api/processing/fill-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ projectId: id, ...payload }),
    })
    if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'request failed') }
    return res.json() as Promise<{ ok: boolean; remaining: number }>
  }, [id])

  const refreshProcessedUrl = useCallback(async () => {
    if (!project?.processed_file_path) return
    const { data } = await supabase.storage.from('projects').createSignedUrl(project.processed_file_path, 3600)
    if (data?.signedUrl) setProcessedFileUrl(data.signedUrl)
  }, [project?.processed_file_path])

  const handleSave = useCallback(async (inputId: string) => {
    const text = fills[inputId]?.trim()
    if (!text) return
    setSavingId(inputId)
    try {
      const result = await callFillApi({ fills: { [inputId]: text } })
      const newPending = pendingInputs.filter(p => p.id !== inputId)
      setPendingInputs(newPending)
      setProject(prev => prev ? {
        ...prev,
        pending_inputs: newPending.length > 0 ? newPending : null,
        status: result.remaining === 0 ? 'complete' : 'needs_input',
      } : prev)
      setFills(prev => { const n = { ...prev }; delete n[inputId]; return n })
      await refreshProcessedUrl()
    } catch (err) {
      console.error('fill failed:', err)
    } finally {
      setSavingId(null)
    }
  }, [fills, pendingInputs, callFillApi, refreshProcessedUrl])

  const handleRemoveConfirm = useCallback(async () => {
    if (!removeTarget) return
    setRemoveConfirming(true)
    try {
      const result = await callFillApi({ removals: [removeTarget.id] })
      const newPending = pendingInputs.filter(p => p.id !== removeTarget.id)
      setPendingInputs(newPending)
      setProject(prev => prev ? {
        ...prev,
        pending_inputs: newPending.length > 0 ? newPending : null,
        status: result.remaining === 0 ? 'complete' : 'needs_input',
      } : prev)
      await refreshProcessedUrl()
    } catch (err) {
      console.error('remove failed:', err)
    } finally {
      setRemoveConfirming(false)
      setRemoveTarget(null)
    }
  }, [removeTarget, pendingInputs, callFillApi, refreshProcessedUrl])

  return (
    <>
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Viewer top bar — back button · version label · zoom controls */}
      <div
        className="absolute top-[4rem] left-0 right-0 md:right-80 z-20 flex items-center gap-3 px-4 py-3 pointer-events-none"
      >
        <Link
          to={ROUTES.dashboard}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors pointer-events-auto bg-white/80 backdrop-blur-sm border border-border rounded-xl px-3 py-2 shadow-sm shrink-0"
        >
          <ArrowLeft size={14} />
          {t('project.backToDashboard')}
        </Link>

        <span className="text-muted/40 select-none shrink-0">·</span>
        <span className={`text-xs shrink-0 px-2.5 py-1 rounded-lg border transition-colors duration-150 ${canSeeProcessed ? 'text-forest' : 'text-muted'} ${scrolled ? 'bg-white border-border' : 'bg-transparent border-transparent'}`}>
          {canSeeProcessed ? t('project.viewingFinal') : t('project.viewingOriginal')}
        </span>

        <div className="flex-1" />

        {previewUrl && (
          <div className="pointer-events-auto shrink-0">
            <ZoomControls zoom={zoom} setZoom={setZoom} />
          </div>
        )}
      </div>

      {/* File viewer */}
      <div ref={viewerWrapRef} className="flex-1 min-h-0 bg-[#E8E6DF] flex flex-col">
        {previewUrl && isPdf ? (
          <PdfViewer
            url={previewUrl}
            fileName={project.original_file_name}
            selectedPages={selectedPages}
            pageCount={project.page_count}
            zoom={zoom}
          />
        ) : previewUrl && isDocx ? (
          <DocxViewer
            url={previewUrl}
            fileName={project.original_file_name}
            zoom={zoom}
            pageBreakLabel={t('project.pageBreak')}
            onRendered={handleDocxRendered}
          >
            {status === 'needs_input' && overlayPositions.map(({ id, top }) => {
              const inp = pendingInputs.find(p => p.id === id)
              if (!inp) return null
              const labelKey = inp.kind === 'figure-caption' ? 'fillIn.figureCaption'
                : inp.kind === 'figure-source' ? 'fillIn.figureSource'
                : inp.kind === 'table-caption' ? 'fillIn.tableCaption'
                : 'fillIn.tableSource'
              const phKey = inp.kind.endsWith('-source') ? 'fillIn.placeholder.source' : 'fillIn.placeholder.caption'
              const isSaving = savingId === id
              return (
                <div
                  key={id}
                  style={{ position: 'absolute', top, right: 12, width: 248 }}
                  className="bg-white border border-orange-200 rounded-xl shadow-sm p-3 flex flex-col gap-2"
                >
                  <span className="text-xs font-medium text-orange-700 leading-tight">
                    {t(`project.${labelKey}`, { n: inp.ordinal })}
                  </span>
                  <input
                    type="text"
                    value={fills[id] ?? ''}
                    onChange={e => setFills(prev => ({ ...prev, [id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') handleSave(id) }}
                    placeholder={t(`project.${phKey}`)}
                    className="text-xs text-ink border border-border rounded-lg px-2.5 py-1.5 outline-none focus:border-forest transition-colors w-full"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleSave(id)}
                      disabled={isSaving || !fills[id]?.trim()}
                      className="flex-1 text-xs font-medium bg-ink text-[#F0EEE8] rounded-lg px-2 py-1.5 hover:bg-ink/90 transition-colors disabled:opacity-40"
                    >
                      {isSaving ? t('project.fillIn.saving') : t('project.fillIn.save')}
                    </button>
                    <button
                      onClick={() => setRemoveTarget(inp)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-red-600 hover:bg-red-50 transition-colors shrink-0"
                      aria-label={t('project.fillIn.removeButton')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </DocxViewer>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-white border border-border flex items-center justify-center">
              <FileText size={24} className="text-muted" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-muted max-w-xs">{t('project.noPreview')}</p>
            {(canSeeProcessed || fileUrl) && (
              <Button asChild variant="outline">
                <a href={(canSeeProcessed ? processedFileUrl : fileUrl)!} download={project.original_file_name}>
                  <Download size={14} />
                  {canSeeProcessed ? t('project.downloadFinalFile') : t('project.downloadFile')}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Details panel */}
      <div className="w-80 border-l border-border bg-white flex flex-col overflow-y-auto">
        <div className="px-6 py-5 border-b border-border shrink-0">
          <h1 className="text-base font-semibold text-ink leading-snug mb-1">
            {project.title || project.original_file_name}
          </h1>
          {project.title && (
            <p className="text-xs text-muted truncate mb-3">{project.original_file_name}</p>
          )}
          <Badge variant={STATUS_BADGE_VARIANT[status]}>
            {t(`dashboard.status.${status}`)}
          </Badge>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4">
          {project.services.map((service) => (
            <DetailRow key={service} label={t('project.service')}>
              <span className="text-sm text-ink font-medium">
                {t(`dashboard.service.${service}`)}
                {project.guideline && (
                  <span className="text-muted font-normal">
                    {' · '}{t(`services.guidelines.${project.guideline}.name`)}
                  </span>
                )}
              </span>
            </DetailRow>
          ))}
          <DetailRow label={isDocx ? t('laudas.totalLaudas') : t('project.pageCount')}>
            <span className="text-sm text-ink">{project.page_count}</span>
          </DetailRow>
          {referencesPages.length > 0 && (
            <DetailRow label={t('project.referencesPages')}>
              <span className="text-sm text-ink">{formatPageRanges(referencesPages)}</span>
            </DetailRow>
          )}
          <DetailRow label={t('project.cost')}>
            <span className="text-sm text-ink font-medium">{formatBRL(totalCost)}</span>
          </DetailRow>
          <DetailRow label={t('project.createdAt')}>
            <span className="text-sm text-ink">{formatDate(project.created_at)}</span>
          </DetailRow>
          <DetailRow label={t('project.fileName')}>
            <span className="text-sm text-ink break-all">{project.original_file_name}</span>
          </DetailRow>
        </div>

        {(canDownloadProcessed || fileUrl) && (
          <div className="px-6 pb-6 mt-auto shrink-0 flex flex-col gap-2">
            <Button asChild className="w-full" disabled={!canDownloadProcessed}>
              <a href={canDownloadProcessed ? processedFileUrl! : '#'} download={canDownloadProcessed ? project.original_file_name : undefined}>
                <Download size={14} />
                {t('project.downloadFinalFile')}
              </a>
            </Button>
            {canDownloadProcessed && processedPdfUrl && (
              <Button asChild className="w-full">
                <a href={processedPdfUrl} download={pdfDownloadName}>
                  <Download size={14} />
                  {t('project.downloadFinalPdf')}
                </a>
              </Button>
            )}
            {fileUrl && (
              <Button asChild variant="tertiary" className="w-full">
                <a href={fileUrl} download={project.original_file_name}>
                  <Download size={14} />
                  {t('project.downloadOriginalFile')}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Remove confirmation modal */}
    {removeTarget && createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm px-4">
        <div className="bg-white rounded-2xl border border-border shadow-lg max-w-sm w-full p-6 flex flex-col gap-4">
          <h2 className="text-base font-semibold text-ink">{t('project.fillIn.removeConfirm.title')}</h2>
          <p className="text-sm text-muted leading-relaxed">{t('project.fillIn.removeConfirm.body')}</p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setRemoveTarget(null)}
              disabled={removeConfirming}
              className="text-sm font-medium text-muted hover:text-ink px-4 py-2 rounded-xl transition-colors"
            >
              {t('project.fillIn.removeConfirm.cancel')}
            </button>
            <button
              onClick={handleRemoveConfirm}
              disabled={removeConfirming}
              className="text-sm font-medium bg-red-600 text-white px-4 py-2 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {removeConfirming ? '…' : t('project.fillIn.removeConfirm.confirm')}
            </button>
          </div>
        </div>
      </div>,
      document.body
    )}
    </>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted uppercase tracking-wider">{label}</span>
      {children}
    </div>
  )
}
