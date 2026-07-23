import { useState, useEffect, useRef, useCallback, useId, forwardRef, useImperativeHandle } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, FileText, Download, Loader2, Upload, Link2, AlertTriangle, Trash2, Check } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { renderAsync } from 'docx-preview'
import { unzipSync, strFromU8 } from 'fflate'
import { ROUTES } from '../lib/routes'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { calcPrice, formatBRL } from '../lib/pricing'
import type { ServiceKey } from '../lib/pricing'
import { decodeFilename } from '../lib/filename'
import { normalizeStatus, STATUS_BADGE_VARIANT } from '../lib/status'
import { sliceDocxByLaudas, getDocxBlocks } from '../lib/docx-slice'
import { analyzeDocument, uploadKeepSet } from '../lib/laudas'
import type { GuidelineId } from '../lib/guidelines'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

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

/** Fixed dd/mm/yyyy — Brazil-first, so this doesn't vary with the browser's locale. */
function formatDate(iso: string): string {
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
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

// docx-preview computes right/center tab-stop positions (used by the sumário's page-
// number column) in a `setTimeout(..., 500)` fired from INSIDE its own `renderAsync` —
// not before it resolves, and not overridable. That computation calibrates itself by
// measuring a probe appended to `document.body`, outside our `zoom` CSS wrapper — so if
// `zoom` is already anything other than 1 when that timeout fires (it normally is,
// since DOCX_ZOOM_DEFAULT is 0.9 and applies from the moment the DOM exists), the
// calibration and the actual (zoomed) content disagree, and every right/center tab stop
// lands at the wrong horizontal position — the sumário's stamped page number renders far
// short of the margin (mistaken for "missing") and can force the entry to wrap. Ordinary
// paragraphs never hit this because they don't use tab stops that reach the page edge.
// The fix: hold the wrapper at zoom 1 (self-consistent — content and the library's own
// calibration match) through that window, THEN apply the real zoom once it's fired.
const TAB_STOP_SETTLE_MS = 600

const DOCX_RENDER_OPTIONS = {
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  experimental: true,
  renderHeaders: true,
  renderFooters: true,
}

const DOCX_PAGE_STYLES = `
  /* Clamp images to the page width so an absolutely-sized author image never
     overflows the rendered page (looked oversized on narrow / laptop columns). */
  .docx-wrapper img { max-width: 100% !important; height: auto !important; }
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
    border-radius: 12px !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06) !important;
    margin-top: 22px !important;
    margin-bottom: 24px !important;
    position: relative !important;
    overflow: visible !important;
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

const PLACEHOLDER_TEXTS = new Set([
  '[inserir legenda da figura]',
  '[inserir fonte]',
  '[inserir legenda da tabela]',
])

/**
 * Whether `applyAbntPageNumbering` (server side) ran on this document — it stamps
 * `<w:pgNumType w:start="…">` on the body section whenever a pré-textual region was
 * split off. Its header carries a real Word `PAGE` field, but the field's cached
 * display run is a static placeholder: Word/LibreOffice recompute it at render
 * time (that's how the exported PDF and the sumário always show the right, per-page
 * numbers), but docx-preview has no field engine and renders that cached run
 * literally on every page. Worse, docx-preview only splits the preview into a new
 * card at explicit hard page breaks, not at every real printed page — so even a
 * per-card counter can't reconstruct the true number whenever one card's content
 * actually spans more than one real page (any figure/table can trigger that).
 * There is no reliable way to show a correct number here, so the preview hides the
 * stamp instead of guessing — the exported PDF and the sumário remain the source
 * of truth for exact page numbers; this preview is Lauda-scoped, not page-scoped.
 */
function hasAbntPageNumbering(buf: ArrayBuffer): boolean {
  try {
    const zip = unzipSync(new Uint8Array(buf))
    const docXml = zip['word/document.xml']
    return !!docXml && /<w:pgNumType\b[^>]*\bw:start="\d+"/.test(strFromU8(docXml))
  } catch {
    return false
  }
}

/**
 * Blank the header's PAGE-field placeholder digit on every rendered page (see
 * `hasAbntPageNumbering`). docx-preview renders a DOCX header as a literal
 * `<header>` element inside each page's `section.docx` (own subtree per page, not
 * a shared reference), so this only touches the browser preview — never the
 * underlying file.
 */
function hidePageNumberStamps(sections: Element[]): void {
  for (const section of sections) {
    const header = section.querySelector(':scope > header')
    if (!header) continue
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (/\S/.test(node.textContent ?? '')) {
        node.textContent = ''
        break
      }
    }
  }
}

export interface DocxViewerHandle {
  scrollToPlaceholder(allPending: PendingInputFE[], target: PendingInputFE): void
}

const DocxViewer = forwardRef<DocxViewerHandle, {
  url: string
  fileName: string
  zoom: number
  pageBreakLabel: string
}>(function DocxViewer({
  url,
  fileName,
  zoom,
  pageBreakLabel,
}, ref) {
  const { t } = useTranslation()
  const outerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const styleRef = useRef<HTMLDivElement>(null)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)

  useImperativeHandle(ref, () => ({
    scrollToPlaceholder(allPending: PendingInputFE[], target: PendingInputFE) {
      const body = bodyRef.current
      if (!body) return
      const sorted = [...allPending].sort((a, b) => a.insertedAt - b.insertedAt)
      const targetIdx = sorted.findIndex(p => p.id === target.id)
      if (targetIdx < 0) return
      const elements: Element[] = []
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim() ?? ''
        if (PLACEHOLDER_TEXTS.has(text)) {
          const el = node.parentElement
          if (el) {
            const color = window.getComputedStyle(el).color
            if (color === 'rgb(255, 0, 0)') elements.push(el)
          }
        }
      }
      elements[targetIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    },
  }), [])

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
        const [, hasPageNumbering] = await Promise.all([
          renderAsync(blob, body, style, DOCX_RENDER_OPTIONS),
          blob.arrayBuffer().then(hasAbntPageNumbering),
        ])
        console.log(`[DocxViewer timing] renderAsync: ${Math.round(performance.now() - tRender)}ms`)
        return hasPageNumbering
      })
      .then((hasPageNumbering) => {
        if (cancelled) return
        body.querySelectorAll('section.docx').forEach((section) => {
          if ((section as HTMLElement).innerText.trim() === '') section.remove()
        })
        const sections = Array.from(body.querySelectorAll('section.docx'))
        // The header's PAGE field is a static placeholder in this preview (see
        // `hasAbntPageNumbering`) — hide it rather than show a number that can't be
        // made reliably correct. The exported PDF and the sumário stay accurate.
        if (hasPageNumbering) hidePageNumberStamps(sections)
        // Insert "Page break" dividers between sections — a dashed rule on each
        // side of a badge label, so the gap reads as an intentional break.
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
        // Keep the loading state (which also holds zoom at 1 — see the wrapper's
        // `style` below) until docx-preview's internal, delayed tab-stop pass has
        // actually fired. See TAB_STOP_SETTLE_MS above.
        return new Promise<void>(res => setTimeout(res, TAB_STOP_SETTLE_MS))
      })
      .then(() => {
        if (cancelled) return
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
      {/* The content stays in normal flow the WHOLE time — the opaque loading spinner
          (absolute inset-0 above) is what hides it, NOT `display:none`. Two reasons:
          (1) docx-preview's delayed tab-stop pass (see TAB_STOP_SETTLE_MS) sizes each
          right tab by measuring `getBoundingClientRect()`; on a `display:none` element
          every rect is 0, so it baked a giant tab word-spacing and wrapped the sumário's
          page-number column onto a second line. (2) A `display:none`→shown OR
          `visibility:hidden`→shown flip on this large, zoomed subtree can leave Chrome
          laid-out-but-not-repainted (blank viewer). Keeping it always in flow avoids both.
          Zoom is still held at 1 through the settle window so the tab measurement is
          self-consistent (see the wrapper comment on TAB_STOP_SETTLE_MS). */}
      <div style={{ zoom: loading ? 1 : zoom }}>
        <div ref={styleRef} />
        <div ref={bodyRef} className="docx-body" />
      </div>
    </div>
  )
})

// ── Pending inputs panel ─────────────────────────────────────────────────────

const DONT_ASK_BLANK_INPUT_KEY = 'formatexto.dontAskBlankInput'

/** Groups pending inputs so the panel can separate tables from figures with a group title. */
const PENDING_INPUT_CATEGORY: Record<PendingInputFE['kind'], 'table' | 'figure'> = {
  table_caption: 'table',
  table_source: 'table',
  figure_caption: 'figure',
  figure_source: 'figure',
}
function groupPendingInputsByCategory(
  inputs: PendingInputFE[]
): { category: 'table' | 'figure'; items: PendingInputFE[] }[] {
  const groups: { category: 'table' | 'figure'; items: PendingInputFE[] }[] = []
  for (const input of inputs) {
    const category = PENDING_INPUT_CATEGORY[input.kind]
    const last = groups[groups.length - 1]
    if (last?.category === category) last.items.push(input)
    else groups.push({ category, items: [input] })
  }
  return groups
}

/** A section title separating one content type's group of pending inputs from the next. */
function CategoryTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-ink -mb-1">{children}</h3>
}

/** Small square checkbox matching the app's hand-rolled checkbox look (see PageSelectionPage). */
const MiniCheckbox = forwardRef<HTMLButtonElement, {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}>(function MiniCheckbox({ checked, onChange, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-left w-full"
    >
      <div className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
        checked ? 'bg-forest border-forest' : 'border-border'
      }`}>
        {checked && <Check size={8} className="text-white" strokeWidth={3} aria-hidden="true" />}
      </div>
      <span className="text-xs text-muted leading-snug">{children}</span>
    </button>
  )
})

/**
 * The "Deixar em branco" trigger + its confirmation popover. An `alertdialog` (not a
 * plain `dialog`) since it's an interruptive warning-plus-confirm prompt — per ARIA
 * authoring practices, focus opens on the least-destructive action (Cancel), Tab is
 * trapped inside while open, and focus returns to the trigger on every close path.
 */
function BlankConfirmButton({ fieldLabel, guidelineName, onConfirm }: {
  fieldLabel: string
  guidelineName: string
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [rememberChoice, setRememberChoice] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const checkboxRef = useRef<HTMLButtonElement>(null)
  const warningId = useId()

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    cancelRef.current?.focus()

    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close()
        return
      }
      if (e.key !== 'Tab') return
      // Trap focus inside the popover — cycle Cancel → Confirm → checkbox → Cancel.
      const focusable = [cancelRef.current, confirmRef.current, checkboxRef.current].filter(
        (el): el is HTMLButtonElement => !!el
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleTriggerClick = () => {
    if (localStorage.getItem(DONT_ASK_BLANK_INPUT_KEY) === 'true') {
      onConfirm()
      return
    }
    setOpen(true)
  }

  const handleConfirm = () => {
    if (rememberChoice) localStorage.setItem(DONT_ASK_BLANK_INPUT_KEY, 'true')
    close()
    onConfirm()
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t('project.inputs.blank')}: ${fieldLabel}`}
        onClick={handleTriggerClick}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-800 transition-colors"
      >
        <Trash2 size={13} aria-hidden="true" />
        {t('project.inputs.blank')}
      </button>

      {open && (
        <div
          role="alertdialog"
          aria-label={`${t('project.inputs.blank')}: ${fieldLabel}`}
          aria-describedby={warningId}
          className="absolute right-0 top-full mt-2 w-72 bg-white border border-border rounded-xl shadow-md p-4 z-50 flex flex-col gap-3"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <AlertTriangle size={18} className="text-amber-600 shrink-0" aria-hidden="true" />
            <p id={warningId} className="text-xs text-ink leading-relaxed text-balance">
              {t('project.inputs.blankWarning', { guideline: guidelineName })}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={close}
              className="flex-1 text-xs font-medium text-muted hover:text-ink transition-colors px-3 py-1.5 rounded-lg hover:bg-[#F0EEE8]"
            >
              {t('project.inputs.blankCancel')}
            </button>
            <button
              ref={confirmRef}
              type="button"
              onClick={handleConfirm}
              className="flex-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 transition-colors px-3 py-1.5 rounded-lg"
            >
              {t('project.inputs.blankConfirm')}
            </button>
          </div>
          <MiniCheckbox ref={checkboxRef} checked={rememberChoice} onChange={setRememberChoice}>
            {t('project.inputs.blankDontAskAgain')}
          </MiniCheckbox>
        </div>
      )}
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
  const [recovering, setRecovering] = useState(false)
  const [recoverError, setRecoverError] = useState<string | null>(null)
  const viewerWrapRef = useRef<HTMLDivElement>(null)
  const docxViewerRef = useRef<DocxViewerHandle>(null)
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

  // Missing-file recovery: re-upload the (paid) project's file. Uploads to Storage under
  // the project's own folder, then asks the server to stamp the path and re-trigger the
  // pipeline. No new order is created — the user is not re-charged.
  const handleRecoverUpload = useCallback(async (file: File) => {
    if (!project || !session || recovering) return
    if (!file.name.toLowerCase().endsWith('.docx')) {
      setRecoverError('invalidType')
      return
    }
    setRecovering(true)
    setRecoverError(null)
    try {
      // Re-slice to the laudas the user originally paid for. The server never slices
      // (checkout slices before upload), so a full re-uploaded file would otherwise get
      // ALL laudas processed. `selected_pages` holds the paid lauda numbers; recompute
      // them from this file (same word-boundary algorithm) and keep only those blocks.
      // Same file ⇒ same lauda numbering, so the selection maps 1:1.
      let fileToUpload = file
      const selectedLaudas = project.selected_pages ?? []
      if (selectedLaudas.length > 0) {
        try {
          const blocks = await getDocxBlocks(file)
          const { laudas } = analyzeDocument(blocks)
          // Only slice when the selection is a real subset — if it already covers every
          // lauda, keep the file whole (avoids a pointless re-zip). Pré-textuais are
          // always retained by uploadKeepSet regardless of the lauda selection.
          if (selectedLaudas.length < laudas.length) {
            fileToUpload = await sliceDocxByLaudas(file, uploadKeepSet(blocks, selectedLaudas))
          }
        } catch (err) {
          console.error('Recovery slicing failed, uploading full file:', err)
        }
      }

      // Mirror checkout's upload: store the .docx bytes as a .zip-renamed object.
      const uploadFile = new File([fileToUpload], file.name.replace(/\.docx$/i, '.zip'), { type: 'application/zip' })
      const safeName = uploadFile.name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '_')
      const path = `${session.user.id}/${project.id}/original/${safeName}`
      const { error: upErr } = await supabase.storage
        .from('projects')
        .upload(path, uploadFile, { upsert: true })
      if (upErr) throw new Error(upErr.message)

      const res = await fetch(`${API_URL}/api/processing/recover-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId: project.id, path, fileName: file.name }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? String(res.status))
      }
      window.location.reload()
    } catch (err) {
      setRecoverError(String(err instanceof Error ? err.message : err))
      setRecovering(false)
    }
  }, [project, session, recovering])

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
  const isMissingFile = status === 'missing_file'
  const canSeeProcessed = !!processedFileUrl && (status === 'complete' || status === 'needs_input')
  const canDownloadProcessed = !!processedFileUrl && status === 'complete'
  const canFinalize = hasNeedsInput &&
    pendingInputs.every(p => removals.has(p.id) || (fills.get(p.id) ?? '').trim().length > 0)
  const previewUrl = canSeeProcessed ? processedFileUrl : fileUrl
  const pdfDownloadName = project.original_file_name.replace(/\.docx$/i, '') + '.pdf'
  const selectedPages = project.selected_pages ?? []

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

      {/* File viewer — or the missing-file recovery uploader in its place */}
      <div ref={viewerWrapRef} className="flex-1 min-h-0 bg-[#E8E6DF] flex flex-col">
        {isMissingFile ? (
          <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
            <RecoverUpload onFile={handleRecoverUpload} busy={recovering} submitError={recoverError} />
          </div>
        ) : previewUrl && isPdf ? (
          <PdfViewer
            url={previewUrl}
            fileName={project.original_file_name}
            selectedPages={selectedPages}
            pageCount={project.page_count}
            zoom={zoom}
          />
        ) : previewUrl && isDocx ? (
          <DocxViewer
            ref={docxViewerRef}
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
        <div className="px-6 py-5 border-b border-border shrink-0 flex flex-col gap-4">
          <div>
            <h1 className="text-base font-semibold text-ink leading-snug mb-1">
              {project.title || project.original_file_name}
            </h1>
            {project.title && (
              <p className="text-xs text-muted truncate mb-3">{project.original_file_name}</p>
            )}
            <Badge role="status" variant={STATUS_BADGE_VARIANT[status]}>
              {t(`dashboard.status.${status}`)}
            </Badge>
          </div>
          <DetailRow label={t('project.service')}>
            <div className="flex flex-col gap-0.5">
              {project.services.map((service) => (
                <span key={service} className="text-sm text-ink font-medium">
                  {t(`dashboard.service.${service}`)}
                  {/* Guideline only applies to formatting — proofreading has none. */}
                  {service === 'formatting' && project.guideline && (
                    <span className="text-muted font-normal">
                      {' · '}{t(`services.guidelines.${project.guideline}.name`)}
                    </span>
                  )}
                </span>
              ))}
            </div>
          </DetailRow>
          <DetailRow label={isDocx ? t('laudas.totalLaudas') : t('project.pageCount')}>
            <span className="text-sm text-ink">{project.page_count}</span>
          </DetailRow>
          <div className="grid grid-cols-2 gap-4">
            <DetailRow label={t('project.cost')}>
              <span className="text-sm text-ink font-medium">{formatBRL(totalCost)}</span>
            </DetailRow>
            <DetailRow label={t('project.createdAt')}>
              <span className="text-sm text-ink">{formatDate(project.created_at)}</span>
            </DetailRow>
          </div>
        </div>

        {hasNeedsInput && (
          <div className="px-6 py-5 border-t border-border shrink-0 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-ink">{t('project.inputs.title')}</h2>
            {groupPendingInputsByCategory(pendingInputs).map((group) => (
              <div key={group.category} className="flex flex-col gap-4">
                <CategoryTitle>
                  {t(group.category === 'table' ? 'project.inputs.groupTable' : 'project.inputs.groupFigure')}
                </CategoryTitle>
                {group.items.map((p) => {
                  const isRemoved = removals.has(p.id)
                  const labelKey = `project.inputs.${p.kind}` as const
                  const placeholderKey = `project.inputs.placeholder_${p.kind}` as const
                  const fieldLabel = t(labelKey, { n: p.ordinal })
                  const labelId = `pending-input-label-${p.id}`
                  return (
                    <div key={p.id} className={`flex flex-col gap-1.5 ${isRemoved ? 'opacity-50' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span id={labelId} className="text-xs font-medium text-muted uppercase tracking-wider">
                          {fieldLabel}
                        </span>
                        {isRemoved ? (
                          <button
                            aria-label={`${t('project.inputs.restore')}: ${fieldLabel}`}
                            className="text-xs font-medium text-forest hover:text-forest-mid transition-colors shrink-0"
                            onClick={() => setRemovals(prev => { const s = new Set(prev); s.delete(p.id); return s })}
                          >
                            {t('project.inputs.restore')}
                          </button>
                        ) : (
                          <BlankConfirmButton
                            fieldLabel={fieldLabel}
                            guidelineName={project.guideline ? t(`services.guidelines.${project.guideline}.name`) : ''}
                            onConfirm={() => {
                              setRemovals(prev => new Set([...prev, p.id]))
                              setFills(prev => { const m = new Map(prev); m.delete(p.id); return m })
                            }}
                          />
                        )}
                      </div>
                      {!isRemoved && (
                        <Textarea
                          rows={3}
                          aria-labelledby={labelId}
                          placeholder={t(placeholderKey)}
                          value={fills.get(p.id) ?? ''}
                          onChange={e => setFills(prev => new Map([...prev, [p.id, e.target.value]]))}
                          onFocus={() => docxViewerRef.current?.scrollToPlaceholder(pendingInputs, p)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
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

/**
 * Missing-file recovery uploader, shown in place of the viewer when a paid project has no
 * file. Mirrors GetStartedPage's input: a tab switcher between a local `.docx` drop zone
 * and a Google-Docs URL fetch. Both paths resolve to a File handed to `onFile`, which the
 * parent uploads + recovers. `busy` covers the parent's upload; `submitError` is its error.
 */
function RecoverUpload({
  onFile,
  busy,
  submitError,
}: {
  onFile: (file: File) => void
  busy: boolean
  submitError: string | null
}) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'upload' | 'link'>('upload')
  const [dragging, setDragging] = useState(false)
  const [typeError, setTypeError] = useState<'doc' | 'invalid' | null>(null)
  const [url, setUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isDocConvert = (f: File) => /\.doc$/i.test(f.name) && !/\.docx$/i.test(f.name)
  const isDocx = (f: File) => /\.docx$/i.test(f.name)

  function pick(f: File) {
    if (isDocConvert(f)) { setTypeError('doc'); return }
    if (!isDocx(f)) { setTypeError('invalid'); return }
    setTypeError(null)
    onFile(f)
  }

  async function fetchFromUrl() {
    if (!url.trim() || fetching || busy) return
    setLinkError(null)
    setFetching(true)
    try {
      const linkToken = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`${API_URL}/api/documents/fetch?url=${encodeURIComponent(url)}`, {
        headers: linkToken ? { Authorization: `Bearer ${linkToken}` } : {},
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setLinkError((data as { error?: string }).error ?? t('project.recover.error'))
        setFetching(false)
        return
      }
      const blob = await res.blob()
      const filename = decodeFilename(res.headers.get('X-Filename'))
      onFile(new File([blob], filename, { type: blob.type }))
      // Leave `fetching` true — the parent's busy state + reload take over from here.
    } catch {
      setLinkError(t('project.recover.error'))
      setFetching(false)
    }
  }

  const working = busy || fetching

  return (
    <div className="w-full max-w-lg bg-white rounded-2xl border border-border px-6 py-6 shadow-sm">
      <h2 className="text-base font-semibold text-ink mb-1">{t('project.recover.title')}</h2>
      <p className="text-sm text-muted mb-5 leading-relaxed">{t('project.recover.description')}</p>

      {working ? (
        <div className="h-48 rounded-xl border border-border bg-[#F0EEE8] flex flex-col items-center justify-center gap-3">
          <Loader2 size={22} className="text-forest animate-spin" />
          <p className="text-sm font-medium text-ink">{t('project.recover.uploading')}</p>
        </div>
      ) : (
        <>
          {/* Tab switcher */}
          <div className="flex rounded-lg border border-border overflow-hidden mb-4">
            <button
              type="button"
              onClick={() => setTab('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                tab === 'upload' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <Upload size={14} />
              {t('hero.uploadTab')}
            </button>
            <button
              type="button"
              onClick={() => setTab('link')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                tab === 'link' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <Link2 size={14} />
              {t('hero.linkTab')}
            </button>
          </div>

          {tab === 'upload' ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".docx"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }}
              />
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) pick(f) }}
                onClick={() => fileInputRef.current?.click()}
                className={`h-48 rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-3 transition-colors ${
                  typeError ? 'border-red-400 bg-red-50' : dragging ? 'border-forest-mid bg-forest-mid/5' : 'border-border hover:border-forest-mid/50'
                }`}
              >
                <Upload size={24} className={typeError ? 'text-red-400' : 'text-muted'} strokeWidth={1.5} />
                <p className="text-sm font-medium text-ink">{t('hero.dropPrompt')}</p>
                {typeError === 'doc' ? (
                  <p className="text-xs text-red-500 text-center px-6">{t('getStarted.fileCard.docConvert')}</p>
                ) : typeError === 'invalid' ? (
                  <p className="text-xs text-red-500 text-center px-6">{t('project.recover.invalidType')}</p>
                ) : (
                  <p className="text-xs text-muted">{t('hero.fileLimit')}</p>
                )}
                <span className="text-xs border border-border rounded px-2 py-0.5 text-muted">.docx</span>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border px-4 py-4 flex flex-col gap-3">
              <label className="text-xs font-medium text-muted uppercase tracking-wider">
                {t('hero.documentUrl')}
              </label>
              <Input
                type="url"
                placeholder="https://docs.google.com/..."
                value={url}
                onChange={(e) => { setUrl(e.target.value); setLinkError(null) }}
                className="rounded-lg py-2.5"
              />
              {linkError ? (
                <p className="text-xs text-red-500">{linkError}</p>
              ) : (
                <p className="text-xs text-muted">{t('hero.linksSupported')}</p>
              )}
              <Button className="w-full" disabled={!url.trim()} onClick={fetchFromUrl}>
                {t('project.recover.button')}
              </Button>
            </div>
          )}

          {submitError && (
            <p className="text-xs text-red-600 mt-3">{t('project.recover.error')}</p>
          )}
        </>
      )}
    </div>
  )
}
