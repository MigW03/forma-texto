import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileText, Download, Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderAsync } from 'docx-preview'
import { ROUTES } from '../lib/routes'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { calcPrice, formatBRL } from '../lib/pricing'
import type { ServiceKey } from '../lib/pricing'
import { formatPageRanges } from '../lib/format'
import { normalizeStatus, STATUS_BADGE_VARIANT } from '../lib/status'
import type { GuidelineId } from '../lib/guidelines'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

interface PendingInputFE {
  id: string
  kind: 'figure_caption' | 'figure_source' | 'table_caption' | 'table_source'
  ordinal: number
  insertedAt: number
}

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
  completed_at: string | null
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
}: {
  url: string
  fileName: string
  zoom: number
  pageBreakLabel: string
}) {
  const { t } = useTranslation()
  const outerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)

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
    const tFetch = performance.now()
    fetch(url)
      .then(r => r.blob())
      .then(async (blob) => {
        console.log(`[DocxViewer timing] file download: ${Math.round(performance.now() - tFetch)}ms · ${(blob.size / 1024).toFixed(0)} KB`)
        // docx-preview's renderAsync builds the whole document DOM synchronously and
        // blocks the main thread (no streaming/worker mode). Yield two frames first so
        // the browser paints the loading state before the freeze — otherwise the spinner
        // never shows and the viewer looks crashed on large documents.
        await new Promise<void>(res => requestAnimationFrame(() => requestAnimationFrame(() => res())))
        if (cancelled) return
        const tRender = performance.now()
        await renderAsync(blob, body, style, DOCX_RENDER_OPTIONS)
        console.log(`[DocxViewer timing] renderAsync: ${Math.round(performance.now() - tRender)}ms`)
      })
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
      })
      .catch(() => { if (!cancelled) { setLoadError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [url, pageBreakLabel])

  if (loadError) return <PreviewError url={url} fileName={fileName} />

  return (
    <div ref={outerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative bg-[#E8E6DF]">
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center px-8 bg-[#E8E6DF]">
          <Loader2 size={28} className="text-forest animate-spin" strokeWidth={1.75} />
          <p className="text-sm font-medium text-ink">{t('project.loadingPreview')}</p>
          <p className="text-xs text-muted max-w-xs">{t('project.loadingPreviewHint')}</p>
        </div>
      )}
      <div style={{ zoom, display: loading ? 'none' : undefined }}>
        <div ref={styleRef} />
        <div ref={bodyRef} className="docx-body" />
      </div>
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

// Key the processed-file URL on a content version (the project's `completed_at`,
// which the server bumps on every write to the file) rather than a one-shot
// timestamp. A stable token lets the CDN cache repeat views; the token only
// changes when the file actually changes, so an overwrite is still served fresh.
// Falls back to `Date.now()` when there's no version yet (e.g. needs_input).
function bustCache(signedUrl: string, version: string | null | undefined): string {
  const token = version ? encodeURIComponent(version) : Date.now()
  return `${signedUrl}&_cb=${token}`
}

export default function ProjectDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const { session } = useAuth()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [processedFileUrl, setProcessedFileUrl] = useState<string | null>(null)
  const [processedPdfUrl, setProcessedPdfUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [fills, setFills] = useState<Map<string, string>>(new Map())
  const [removals, setRemovals] = useState<Set<string>>(new Set())
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const viewerWrapRef = useRef<HTMLDivElement>(null)
  const signedProcPathRef = useRef<string | null>(null)
  const finalizingRef = useRef(false)

  useEffect(() => {
    if (!id) return
    const t0 = performance.now()
    supabase
      .from('projects')
      .select('id, title, original_file_name, original_file_path, processed_file_path, references_pages, selected_pages, services, guideline, status, page_count, created_at, completed_at, pending_inputs')
      .eq('id', id)
      .single()
      .then(async ({ data, error }) => {
        console.log(`[ProjectDetail timing] DB query: ${Math.round(performance.now() - t0)}ms`)
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setProject(data as ProjectDetail)
        setZoom(data.original_file_name.toLowerCase().endsWith('.docx') ? DOCX_ZOOM_DEFAULT : ZOOM_DEFAULT)
        const pdfPath = pdfPathFor(data.processed_file_path)
        const canSee = data.processed_file_path && (data.status === 'complete' || data.status === 'needs_input')
        const tSign = performance.now()
        const [origSigned, procSigned, pdfSigned] = await Promise.all([
          data.original_file_path
            ? supabase.storage.from('projects').createSignedUrl(data.original_file_path, 3600)
            : Promise.resolve({ data: null }),
          canSee
            ? supabase.storage.from('projects').createSignedUrl(data.processed_file_path!, 3600)
            : Promise.resolve({ data: null }),
          pdfPath && data.status === 'complete'
            ? supabase.storage.from('projects').createSignedUrl(pdfPath, 3600)
            : Promise.resolve({ data: null }),
        ])
        console.log(`[ProjectDetail timing] signed URLs: ${Math.round(performance.now() - tSign)}ms · total to viewer: ${Math.round(performance.now() - t0)}ms`)
        if (origSigned.data?.signedUrl) setFileUrl(origSigned.data.signedUrl)
        if (procSigned.data?.signedUrl) {
          setProcessedFileUrl(bustCache(procSigned.data.signedUrl, data.completed_at))
          signedProcPathRef.current = data.processed_file_path
        }
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
          const updated = payload.new as ProjectDetail
          setProject((prev) => prev ? {
            ...prev,
            status: updated.status,
            processed_file_path: updated.processed_file_path,
            completed_at: updated.completed_at,
            pending_inputs: updated.pending_inputs,
          } : prev)
          // Realtime fires before the HTTP response returns to the client, so
          // clear finalizing here rather than waiting for the fetch round-trip.
          if (updated.status === 'complete') {
            finalizingRef.current = false
            setFinalizing(false)
          }
          const procPath = updated.processed_file_path
          if (procPath && (updated.status === 'needs_input' || updated.status === 'complete') && procPath !== signedProcPathRef.current) {
            const pdfPath = updated.status === 'complete' ? pdfPathFor(procPath) : null
            const [proc, pdf] = await Promise.all([
              supabase.storage.from('projects').createSignedUrl(procPath, 3600),
              pdfPath
                ? supabase.storage.from('projects').createSignedUrl(pdfPath, 3600)
                : Promise.resolve({ data: null }),
            ])
            if (proc.data?.signedUrl) {
              setProcessedFileUrl(bustCache(proc.data.signedUrl, updated.completed_at))
              signedProcPathRef.current = procPath
            }
            if (pdf.data?.signedUrl) setProcessedPdfUrl(pdf.data.signedUrl)
          } else if (updated.status === 'complete' && procPath) {
            // same path, but finalize just landed — re-sign with cache buster
            const pdfPath = pdfPathFor(procPath)
            const [proc, pdf] = await Promise.all([
              supabase.storage.from('projects').createSignedUrl(procPath, 3600),
              pdfPath
                ? supabase.storage.from('projects').createSignedUrl(pdfPath, 3600)
                : Promise.resolve({ data: null }),
            ])
            if (proc.data?.signedUrl) setProcessedFileUrl(bustCache(proc.data.signedUrl, updated.completed_at))
            if (pdf.data?.signedUrl) setProcessedPdfUrl(pdf.data.signedUrl)
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id])

  // ── All hooks must come before early returns (Rules of Hooks) ───────────────

  const handleDownloadProcessed = useCallback(async () => {
    const path = project?.processed_file_path
    const name = project?.original_file_name
    if (!path || !name) return
    const { data } = await supabase.storage.from('projects').createSignedUrl(path, 60)
    if (!data?.signedUrl) return
    const a = document.createElement('a')
    a.href = data.signedUrl
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [project?.processed_file_path, project?.original_file_name])

  const handleFinalize = useCallback(async () => {
    if (!project || !session || finalizingRef.current) return
    finalizingRef.current = true
    setFinalizing(true)
    setFinalizeError(null)
    try {
      const res = await fetch(`${API_URL}/api/processing/finalize-inputs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          projectId: project.id,
          fills: [...fills.entries()].map(([fillId, text]) => ({ id: fillId, text })),
          removals: [...removals],
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? String(res.status))
      }
      window.location.reload()
    } catch (err) {
      setFinalizeError(String(err instanceof Error ? err.message : err))
      finalizingRef.current = false
      setFinalizing(false)
    }
  }, [project, session, fills, removals])

  // ── Early returns (after all hooks) ─────────────────────────────────────────

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
  const pendingInputs = project.pending_inputs ?? []
  const hasNeedsInput = status === 'needs_input' && pendingInputs.length > 0
  const canSeeProcessed = !!processedFileUrl && (status === 'complete' || status === 'needs_input')
  const canDownloadProcessed = !!processedFileUrl && status === 'complete'
  const canFinalize = hasNeedsInput &&
    pendingInputs.every(p => removals.has(p.id) || (fills.get(p.id) ?? '').trim().length > 0)
  const previewUrl = canSeeProcessed ? processedFileUrl : fileUrl
  const pdfDownloadName = project.original_file_name.replace(/\.docx$/i, '') + '.pdf'
  const selectedPages = project.selected_pages ?? []
  const referencesPages = project.references_pages ?? []

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
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-white border border-border flex items-center justify-center">
              <FileText size={24} className="text-muted" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-muted max-w-xs">{t('project.noPreview')}</p>
            {canSeeProcessed && (
              <Button variant="outline" onClick={handleDownloadProcessed}>
                <Download size={14} />
                {t('project.downloadFinalFile')}
              </Button>
            )}
            {!canSeeProcessed && fileUrl && (
              <Button asChild variant="outline">
                <a href={fileUrl} download={project.original_file_name}>
                  <Download size={14} />
                  {t('project.downloadFile')}
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

        {hasNeedsInput && (
          <div className="px-6 py-5 border-t border-border shrink-0 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-ink">{t('project.inputs.title')}</h2>
            {pendingInputs.map((p) => {
              const isRemoved = removals.has(p.id)
              const labelKey = `project.inputs.${p.kind}` as const
              const placeholderKey = `project.inputs.placeholder_${p.kind}` as const
              return (
                <div key={p.id} className={`flex flex-col gap-1.5 ${isRemoved ? 'opacity-50' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted uppercase tracking-wider">
                      {t(labelKey, { n: p.ordinal })}
                    </span>
                    <button
                      className="text-xs text-muted hover:text-ink transition-colors shrink-0"
                      onClick={() => {
                        if (isRemoved) {
                          setRemovals(prev => { const s = new Set(prev); s.delete(p.id); return s })
                        } else {
                          setRemovals(prev => new Set([...prev, p.id]))
                          setFills(prev => { const m = new Map(prev); m.delete(p.id); return m })
                        }
                      }}
                    >
                      {isRemoved ? t('project.inputs.restore') : t('project.inputs.remove')}
                    </button>
                  </div>
                  {!isRemoved && (
                    <textarea
                      className="w-full text-sm text-ink border border-border rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-forest/30 focus:border-forest-light transition-colors bg-white placeholder:text-muted/50"
                      rows={2}
                      placeholder={t(placeholderKey)}
                      value={fills.get(p.id) ?? ''}
                      onChange={e => setFills(prev => new Map([...prev, [p.id, e.target.value]]))}
                    />
                  )}
                </div>
              )
            })}
            {finalizeError && (
              <p className="text-xs text-red-600">{t('project.inputs.finalizeError')}</p>
            )}
            <Button
              className="w-full"
              disabled={!canFinalize || finalizing}
              onClick={handleFinalize}
            >
              {finalizing ? t('project.inputs.finalizing') : t('project.inputs.finalize')}
            </Button>
          </div>
        )}

        {(canDownloadProcessed || fileUrl) && (
          <div className="px-6 pb-6 mt-auto shrink-0 flex flex-col gap-2">
            {canDownloadProcessed && (
              <Button className="w-full" onClick={handleDownloadProcessed}>
                <Download size={14} />
                {t('project.downloadFinalFile')}
              </Button>
            )}
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
