import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileText, Download } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderAsync } from 'docx-preview'
import { ROUTES } from '../lib/routes'
import { supabase } from '../lib/supabase'
import { calcPrice, formatBRL } from '../lib/pricing'
import type { ServiceKey } from '../lib/pricing'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'
type StatusType = 'inQueue' | 'processing' | 'ready' | 'delivered'

interface ProjectDetail {
  id: string
  title: string | null
  original_file_name: string
  original_file_path: string | null
  services: ServiceKey[]
  guideline: GuidelineId | null
  status: string
  page_count: number
  created_at: string
}

const DB_STATUS_MAP: Record<string, StatusType> = {
  pending: 'inQueue',
  processing: 'processing',
  ready: 'ready',
  delivered: 'delivered',
}

const STATUS_VARIANT: Record<StatusType, 'default' | 'processing' | 'ready' | 'delivered'> = {
  inQueue: 'default',
  processing: 'processing',
  ready: 'ready',
  delivered: 'delivered',
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
}: {
  doc: pdfjsLib.PDFDocumentProxy
  pageNum: number
  containerWidth: number
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
      <p className="text-sm font-medium text-muted/80 mb-1.5 pl-0.5">{pageNum}</p>
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

function PdfViewer({ url, pageCount }: { url: string; pageCount: number }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const [zoom, setZoom] = useState(ZOOM_DEFAULT)
  const [zoomInput, setZoomInput] = useState(String(Math.round(ZOOM_DEFAULT * 100)))
  const [loadError, setLoadError] = useState(false)

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

  if (loadError) return null

  const pageWidth = containerWidth * zoom

  return (
    <div ref={outerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative">
      {/* Zoom controls */}
      <div className="sticky top-4 z-10 flex justify-end pr-4 pointer-events-none">
        <div className="inline-flex items-center gap-1 bg-white border border-border rounded-xl px-2 py-1.5 shadow-sm pointer-events-auto">
          <button
            onClick={() => {
              const next = Math.max(ZOOM_MIN, parseFloat((zoom - ZOOM_STEP).toFixed(2)))
              setZoom(next); setZoomInput(String(Math.round(next * 100)))
            }}
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
            onClick={() => {
              const next = Math.min(ZOOM_MAX, parseFloat((zoom + ZOOM_STEP).toFixed(2)))
              setZoom(next); setZoomInput(String(Math.round(next * 100)))
            }}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-[#F0EEE8] transition-colors text-base font-medium"
            aria-label="Zoom in"
          >+</button>
        </div>
      </div>

      {/* Pages */}
      <div className="flex flex-col items-center gap-6 py-4 pb-8 min-w-fit px-8">
        {doc && pageWidth > 0
          ? Array.from({ length: pageCount }, (_, i) => (
              <PdfPage key={i + 1} doc={doc} pageNum={i + 1} containerWidth={pageWidth} />
            ))
          : Array.from({ length: Math.min(pageCount, 3) }, (_, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm animate-pulse" style={{ width: pageWidth || 500, height: (pageWidth || 500) * 1.414 }} />
            ))
        }
      </div>
    </div>
  )
}

// ── DOCX viewer ──────────────────────────────────────────────────────────────

const DOCX_ZOOM_DEFAULT = 0.9

function DocxViewer({ url }: { url: string }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(DOCX_ZOOM_DEFAULT)
  const [zoomInput, setZoomInput] = useState(String(Math.round(DOCX_ZOOM_DEFAULT * 100)))
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    const body = bodyRef.current
    const style = styleRef.current
    if (!body || !style) return

    fetch(url)
      .then(r => r.blob())
      .then(blob => renderAsync(blob, body, style, {
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        experimental: true,
        renderHeaders: true,
        renderFooters: true,
      }))
      .then(() => {
        const override = document.createElement('style')
        override.textContent = `
          .docx-wrapper {
            counter-reset: docx-page;
            background: #E8E6DF !important;
            padding: 32px !important;
            padding-bottom: 8px !important;
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
        `
        style.appendChild(override)
        setLoading(false)
      })
      .catch(() => { setLoadError(true); setLoading(false) })
  }, [url])

  if (loadError) return null

  return (
    <div ref={outerRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-auto relative bg-[#E8E6DF]">
      {/* Zoom controls */}
      <div className="sticky top-4 z-10 flex justify-end pr-4 pointer-events-none">
        <div className="inline-flex items-center gap-1 bg-white border border-border rounded-xl px-2 py-1.5 shadow-sm pointer-events-auto">
          <button
            onClick={() => {
              const next = Math.max(ZOOM_MIN, parseFloat((zoom - ZOOM_STEP).toFixed(2)))
              setZoom(next); setZoomInput(String(Math.round(next * 100)))
            }}
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
            onClick={() => {
              const next = Math.min(ZOOM_MAX, parseFloat((zoom + ZOOM_STEP).toFixed(2)))
              setZoom(next); setZoomInput(String(Math.round(next * 100)))
            }}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-[#F0EEE8] transition-colors text-base font-medium"
            aria-label="Zoom in"
          >+</button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center gap-6 py-8 px-8">
          {[0, 1].map(i => (
            <div key={i} className="bg-white rounded-xl shadow-sm animate-pulse" style={{ width: 595, height: 842 }} />
          ))}
        </div>
      )}

      <div style={{ zoom, display: loading ? 'none' : undefined }}>
        <div ref={styleRef} />
        <div ref={bodyRef} />
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    supabase
      .from('projects')
      .select('id, title, original_file_name, original_file_path, services, guideline, status, page_count, created_at')
      .eq('id', id)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) { setNotFound(true); setLoading(false); return }
        setProject(data as ProjectDetail)
        if (data.original_file_path) {
          const { data: signed } = await supabase.storage
            .from('projects')
            .createSignedUrl(data.original_file_path, 3600)
          if (signed?.signedUrl) setFileUrl(signed.signedUrl)
        }
        setLoading(false)
      })
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

  const status = DB_STATUS_MAP[project.status] ?? 'inQueue'
  const nameLower = project.original_file_name.toLowerCase()
  const isPdf = nameLower.endsWith('.pdf')
  const isDocx = nameLower.endsWith('.docx')
  const totalCost = project.services.reduce((sum, s) => sum + calcPrice(s, project.page_count), 0)

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Back button — top left over file viewer */}
      <div className="absolute top-[4rem] left-0 z-20 px-4 pt-4 pointer-events-none">
        <Link
          to={ROUTES.dashboard}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors pointer-events-auto bg-white/80 backdrop-blur-sm border border-border rounded-xl px-3 py-2 shadow-sm"
        >
          <ArrowLeft size={14} />
          {t('project.backToDashboard')}
        </Link>
      </div>

      {/* File viewer */}
      <div className="flex-1 min-h-0 bg-[#E8E6DF] flex flex-col">
        {fileUrl && isPdf ? (
          <PdfViewer url={fileUrl} pageCount={project.page_count} />
        ) : fileUrl && isDocx ? (
          <DocxViewer url={fileUrl} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="w-14 h-14 rounded-2xl bg-white border border-border flex items-center justify-center">
              <FileText size={24} className="text-muted" strokeWidth={1.5} />
            </div>
            <p className="text-sm text-muted max-w-xs">{t('project.noPreview')}</p>
            {fileUrl && (
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
          <Badge variant={STATUS_VARIANT[status]}>
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
          <DetailRow label={t('project.pageCount')}>
            <span className="text-sm text-ink">{project.page_count}</span>
          </DetailRow>
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

        {fileUrl && (
          <div className="px-6 pb-6 mt-auto shrink-0">
            <Button asChild variant="outline" className="w-full">
              <a href={fileUrl} download={project.original_file_name}>
                <Download size={14} />
                {t('project.downloadFile')}
              </a>
            </Button>
          </div>
        )}
      </div>
    </div>
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
