import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Info, Check, ChevronDown, AlertTriangle, ZoomIn, ZoomOut, Maximize2, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { PRICING, calcPrice, formatBRL } from '../lib/pricing'
import { storeFile } from '../lib/file-store'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGuidelines } from '../lib/guidelines'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const FALLBACK_PAGE_COUNT = 8

function parseRangeInput(input: string, total: number): Set<number> {
  const result = new Set<number>()
  const parts = input.split(',').map(p => p.trim()).filter(Boolean)
  for (const part of parts) {
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (i >= 1 && i <= total) result.add(i)
        }
      }
    } else {
      const n = Number(part)
      if (!isNaN(n) && n >= 1 && n <= total) result.add(n)
    }
  }
  return result
}

function selectionToRangeString(pages: Set<number>, total: number): string {
  if (pages.size === total) return `1-${total}`
  const sorted = Array.from(pages).sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i]
    } else {
      ranges.push(start === end ? `${start}` : `${start}-${end}`)
      start = sorted[i]
      end = sorted[i]
    }
  }
  if (start !== undefined) ranges.push(start === end ? `${start}` : `${start}-${end}`)
  return ranges.join(', ')
}

function PdfPageCanvas({
  doc,
  pageNumber,
  targetWidth = 300,
  forceVisible = false,
}: {
  doc: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  targetWidth?: number
  forceVisible?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(forceVisible)

  useEffect(() => {
    if (forceVisible) { setVisible(true); return }
    const el = wrapRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true) },
      { threshold: 0.05 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [forceVisible])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    let renderTask: pdfjsLib.RenderTask | null = null

    ;(async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const viewport = page.getViewport({ scale: 1 })
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const scale = (targetWidth / viewport.width) * dpr
        const scaled = page.getViewport({ scale })
        canvas.width = Math.round(scaled.width)
        canvas.height = Math.round(scaled.height)
        const ctx = canvas.getContext('2d')!
        renderTask = page.render({ canvasContext: ctx, viewport: scaled })
        await renderTask.promise
      } catch {
        // cancelled or render error
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [visible, doc, pageNumber, targetWidth])

  return (
    <div ref={wrapRef} className="w-full h-full bg-white">
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  )
}

function DocxPageThumbnail({ pageEl, forceVisible = false }: { pageEl: HTMLElement; forceVisible?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(forceVisible)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    if (forceVisible) { setVisible(true); return }
    const el = wrapRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setVisible(true) },
      { threshold: 0.05 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [forceVisible])

  // Track container width so clone re-scales on zoom changes or lightbox mount
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    obs.observe(el)
    setContainerWidth(el.clientWidth)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || containerWidth === 0 || !wrapRef.current) return
    const wrap = wrapRef.current
    const naturalWidth = pageEl.offsetWidth || 816
    const scale = containerWidth / naturalWidth

    const clone = pageEl.cloneNode(true) as HTMLElement
    clone.style.transformOrigin = 'top left'
    clone.style.transform = `scale(${scale})`
    clone.style.width = `${naturalWidth}px`
    clone.style.position = 'absolute'
    clone.style.top = '0'
    clone.style.left = '0'
    clone.style.margin = '0'
    clone.style.pointerEvents = 'none'
    clone.style.overflow = 'hidden'

    wrap.appendChild(clone)
    return () => { if (wrap.contains(clone)) wrap.removeChild(clone) }
  }, [visible, pageEl, containerWidth])

  return <div ref={wrapRef} className="w-full h-full overflow-hidden bg-white relative" />
}

function SkeletonThumbnail() {
  const lineGroups = [
    [14, 18, 22, 26, 30, 34],
    [42, 46, 50, 54],
    [62, 66, 70, 74, 78],
    [86, 90, 94],
  ]
  return (
    <svg viewBox="0 0 100 130" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="130" fill="white" />
      <rect x="8" y="8" width="45" height="3" rx="1.5" fill="#E5E3DD" />
      {lineGroups.map((lines, gi) =>
        lines.map((y, li) => (
          <rect key={`${gi}-${li}`} x="8" y={y}
            width={li === lines.length - 1 ? 40 + (gi % 3) * 10 : 84}
            height="2" rx="1" fill="#DDDBD3"
          />
        ))
      )}
    </svg>
  )
}

export default function PageSelectionPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as {
    file: File | null
    pasteUrl: string
    inputTab: string
    services: string[]
    guideline: string
    pageCount: number | null
    title?: string
  } | null

  const total = state?.pageCount ?? FALLBACK_PAGE_COUNT
  const [effectiveTotal, setEffectiveTotal] = useState(total)

  // PDF
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  useEffect(() => {
    const file = state?.file
    if (!file || !file.name.toLowerCase().endsWith('.pdf')) return
    let cancelled = false
    let doc: pdfjsLib.PDFDocumentProxy | null = null
    file.arrayBuffer().then(buf => {
      if (cancelled) return
      return pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise
    }).then(d => {
      if (!cancelled) { doc = d; setPdfDoc(d) }
    }).catch(() => {})
    return () => { cancelled = true; doc?.destroy() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Docx — render with breakPages:true so each sectPr becomes its own <section>
  const hiddenDocxRef = useRef<HTMLDivElement | null>(null)
  const [docxPages, setDocxPages] = useState<HTMLElement[]>([])
  useEffect(() => {
    const file = state?.file
    if (!file) return
    const name = file.name.toLowerCase()
    if (!name.endsWith('.docx')) return
    let cancelled = false
    const div = document.createElement('div')
    div.style.cssText = 'position:fixed;visibility:hidden;left:-9999px;top:0;width:816px;overflow:visible;pointer-events:none;'
    document.body.appendChild(div)
    hiddenDocxRef.current = div
    import('docx-preview').then(({ renderAsync }) => {
      if (cancelled) return
      return renderAsync(file, div, undefined, {
        breakPages: true,
        inWrapper: false,
      })
    }).then(() => {
      if (cancelled) return
      const rawPages = Array.from(div.querySelectorAll('section.docx')) as HTMLElement[]
      const pages = rawPages.filter(el => !!(el.textContent?.trim() || el.querySelector('img, table')))
      setDocxPages(pages)
      if (pages.length > 0) {
        setEffectiveTotal(pages.length)
        const all = new Set<number>()
        for (let i = 1; i <= pages.length; i++) all.add(i)
        setSelected(all)
        setRangeInput(pages.length > 1 ? `1-${pages.length}` : '1')
      }
    }).catch(() => {})
    return () => {
      cancelled = true
      if (hiddenDocxRef.current && document.body.contains(hiddenDocxRef.current)) {
        document.body.removeChild(hiddenDocxRef.current)
      }
      hiddenDocxRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [activeServices, setActiveServices] = useState<Set<string>>(
    () => new Set(state?.services ?? [])
  )
  const [guideline, setGuideline] = useState<string>(state?.guideline ?? 'abnt')
  const guidelines = useGuidelines()
  const [hasReferences, setHasReferences] = useState(true)

  // If the carried-over guideline isn't in the loaded catalog, snap to the first.
  useEffect(() => {
    if (guidelines.length && !guidelines.some(g => g.id === guideline)) {
      setGuideline(guidelines[0].id)
    }
  }, [guidelines, guideline])
  const [referencesPagesInput, setReferencesPagesInput] = useState('')

  const toggleService = (svc: string) => {
    setActiveServices(prev => {
      const next = new Set(prev)
      next.has(svc) ? next.delete(svc) : next.add(svc)
      return next
    })
  }

  const [selected, setSelected] = useState<Set<number>>(() => {
    const all = new Set<number>()
    for (let i = 1; i <= total; i++) all.add(i)
    return all
  })
  const [rangeInput, setRangeInput] = useState(total > 1 ? `1-${total}` : `${total}`)
  const [rangeError, setRangeError] = useState(false)
  const [lastClicked, setLastClicked] = useState<number | null>(null)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [previewPage, setPreviewPage] = useState<number | null>(null)

  const ZOOM_GRID = [
    'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5',
    'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
    'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
    'grid-cols-1 sm:grid-cols-2',
  ]
  const ZOOM_PDF_WIDTH = [300, 420, 540, 660]
  const gridClass = ZOOM_GRID[zoomLevel - 1]
  const pdfTargetWidth = ZOOM_PDF_WIDTH[zoomLevel - 1]

  // Sync range input → selection
  const applyRange = useCallback((input: string) => {
    const parsed = parseRangeInput(input, effectiveTotal)
    if (parsed.size > 0) {
      setSelected(parsed)
      setRangeError(false)
    } else {
      setRangeError(true)
    }
  }, [effectiveTotal])

  // Sync selection → range input
  useEffect(() => {
    if (selected.size === 0) {
      setRangeInput('')
    } else {
      setRangeInput(selectionToRangeString(selected, effectiveTotal))
    }
  }, [selected, effectiveTotal])

  const togglePage = (page: number, shiftHeld: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (shiftHeld && lastClicked !== null) {
        const from = Math.min(lastClicked, page)
        const to = Math.max(lastClicked, page)
        const allInRange = Array.from({ length: to - from + 1 }, (_, i) => from + i)
        const shouldSelect = !prev.has(page)
        allInRange.forEach(p => shouldSelect ? next.add(p) : next.delete(p))
      } else {
        next.has(page) ? next.delete(page) : next.add(page)
      }
      return next
    })
    setLastClicked(page)
  }

  const parsedRefPages = hasReferences && referencesPagesInput.trim()
    ? parseRangeInput(referencesPagesInput, effectiveTotal)
    : new Set<number>()
  const validRefPages = new Set([...parsedRefPages].filter(p => selected.has(p)))
  const excludedRefPages = new Set([...parsedRefPages].filter(p => !selected.has(p)))
  const referencesValid = !hasReferences || (referencesPagesInput.trim() !== '' && validRefPages.size > 0)
  const canContinue = selected.size > 0 && activeServices.size > 0 && referencesValid

  if (!state) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted mb-4">{t('pageSelection.noDocument')}</p>
          <Link to={ROUTES.getStarted} className="text-sm text-ink underline">
            {t('getStarted.backToDashboard')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Main — page grid */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(ROUTES.getStarted, {
              state: {
                file: state.file,
                pasteUrl: state.pasteUrl,
                inputTab: state.inputTab,
                services: Array.from(activeServices),
                guideline,
                pageCount: state.pageCount,
              }
            })}
          >
            <ArrowLeft size={14} />
            {t('pageSelection.backToProjects')}
          </Button>
        </div>

        <div className="flex items-start justify-between mb-1">
          <h1 className="text-xl font-semibold text-ink">{t('pageSelection.title')}</h1>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setZoomLevel(z => Math.max(1, z - 1))}
              disabled={zoomLevel === 1}
              aria-label={t('pageSelection.zoomOut')}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-border/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ZoomOut size={16} />
            </button>
            <button
              onClick={() => setZoomLevel(z => Math.min(4, z + 1))}
              disabled={zoomLevel === 4}
              aria-label={t('pageSelection.zoomIn')}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-border/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </div>
        <p className="text-sm text-muted mb-8">{t('pageSelection.subtitle')}</p>

        <div className={`grid ${gridClass} gap-5`}>
          {Array.from({ length: effectiveTotal }, (_, i) => i + 1).map(page => {
            const isSelected = selected.has(page)
            return (
              <div
                key={page}
                role="checkbox"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={(e) => togglePage(page, e.shiftKey)}
                onKeyDown={(e) => e.key === 'Enter' && togglePage(page, false)}
                className="flex flex-col items-center gap-2 cursor-pointer group select-none"
              >
                {/* Thumbnail card */}
                <div
                  className={`relative w-full aspect-[3/4] rounded-lg overflow-hidden transition-all border-2 shadow-sm ${
                    isSelected
                      ? 'border-forest shadow-forest/10'
                      : 'border-transparent hover:border-forest-mid/30'
                  }`}
                  style={{
                    outline: isSelected ? 'none' : undefined,
                    boxShadow: isSelected
                      ? '0 0 0 3px rgba(30,60,40,0.08)'
                      : '0 1px 4px rgba(0,0,0,0.08)',
                  }}
                >
                  {pdfDoc
                    ? <PdfPageCanvas doc={pdfDoc} pageNumber={page} targetWidth={pdfTargetWidth} />
                    : docxPages[page - 1]
                      ? <DocxPageThumbnail pageEl={docxPages[page - 1]} />
                      : <SkeletonThumbnail />
                  }

                  {/* Checkbox overlay */}
                  <div
                    className={`absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-forest border-forest'
                        : 'bg-white/80 border-border group-hover:border-forest-mid/50'
                    }`}
                  >
                    {isSelected && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* Expand button (hover) */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewPage(page) }}
                    aria-label={t('pageSelection.expandPage', { page })}
                    className="absolute bottom-2 right-2 w-7 h-7 flex items-center justify-center rounded-md bg-white/80 border border-border text-muted opacity-0 group-hover:opacity-100 hover:bg-white hover:text-ink transition-all"
                  >
                    <Maximize2 size={13} />
                  </button>

                  {/* Dim overlay when unselected */}
                  {!isSelected && (
                    <div className="absolute inset-0 bg-white/50" />
                  )}
                </div>

                <span className="text-xs text-muted">
                  {t('pageSelection.page')} {page}
                </span>
              </div>
            )
          })}
        </div>

        {/* Lightbox */}
        {previewPage !== null && (
          <div
            className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6"
            onClick={() => setPreviewPage(null)}
          >
            <div
              className="relative bg-white rounded-2xl overflow-hidden shadow-2xl flex flex-col"
              style={{ maxWidth: '640px', width: '100%', maxHeight: '90vh' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
                <button
                  onClick={() => togglePage(previewPage, false)}
                  className="flex items-center gap-2.5 group/sel select-none"
                >
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    selected.has(previewPage)
                      ? 'bg-forest border-forest'
                      : 'bg-white border-border group-hover/sel:border-forest-mid/50'
                  }`}>
                    {selected.has(previewPage) && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="text-sm font-medium text-ink">
                    {t('pageSelection.page')} {previewPage}
                    <span className="text-muted font-normal"> / {effectiveTotal}</span>
                  </span>
                </button>
                <button
                  onClick={() => setPreviewPage(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-ink hover:bg-border/40 transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Page content */}
              <div className="overflow-y-auto flex-1 p-4">
                {pdfDoc
                  ? <PdfPageCanvas doc={pdfDoc} pageNumber={previewPage} targetWidth={900} forceVisible />
                  : docxPages[previewPage - 1]
                    ? (
                      <div className="w-full aspect-[3/4] relative">
                        <DocxPageThumbnail pageEl={docxPages[previewPage - 1]} forceVisible />
                      </div>
                    )
                    : <SkeletonThumbnail />
                }
              </div>

              {/* Footer nav */}
              <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0">
                <button
                  disabled={previewPage <= 1}
                  onClick={() => setPreviewPage(p => Math.max(1, (p ?? 1) - 1))}
                  className="flex items-center gap-1.5 text-sm text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={15} />
                  {t('pageSelection.prevPage')}
                </button>
                <button
                  disabled={previewPage >= effectiveTotal}
                  onClick={() => setPreviewPage(p => Math.min(effectiveTotal, (p ?? 1) + 1))}
                  className="flex items-center gap-1.5 text-sm text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {t('pageSelection.nextPage')}
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Right panel */}
      <div className="w-[300px] shrink-0 border-l border-border bg-white flex flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col gap-6">
          {/* Info tip */}
          <div className="flex gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <Info size={14} className="shrink-0 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              {t('pageSelection.tip')}
            </p>
          </div>

          {/* Service selection */}
          <div>
            <p className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
              {t('pageSelection.servicesLabel')}
            </p>
            <div className="flex flex-col divide-y divide-border border border-border rounded-xl overflow-hidden">
              {(['proofreading', 'formatting'] as const).map(svc => (
                <button
                  key={svc}
                  onClick={() => toggleService(svc)}
                  className="flex flex-col w-full px-3 py-2.5 bg-white hover:bg-[#F0EEE8] transition-colors text-left"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        activeServices.has(svc) ? 'bg-forest border-forest' : 'border-border'
                      }`}>
                        {activeServices.has(svc) && <Check size={9} className="text-white" strokeWidth={3} />}
                      </div>
                      <span className="text-sm text-ink">{t(`services.${svc}.label`)}</span>
                    </div>
                    <span className="text-xs font-semibold text-ink">
                      {formatBRL(calcPrice(svc, selected.size))}
                    </span>
                  </div>
                  <span className="text-xs text-muted/60 leading-none mt-1 self-end">
                    {formatBRL(PRICING[svc].perPage)}/pg · mín. {formatBRL(PRICING[svc].minimum)}
                  </span>
                </button>
              ))}
            </div>

            {activeServices.has('formatting') && (
              <div className="mt-3">
                <label className="text-xs font-medium text-muted uppercase tracking-widest block mb-2">
                  {t('pageSelection.guidelineLabel')}
                </label>
                <div className="relative">
                  <select
                    value={guideline}
                    onChange={e => setGuideline(e.target.value)}
                    className="w-full text-sm border border-border rounded-xl px-3 py-2.5 pr-8 bg-white focus:outline-none focus:ring-2 focus:ring-forest-mid/30 appearance-none cursor-pointer"
                  >
                    {guidelines.map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          {/* Stats */}
          <div>
            <p className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
              {t('pageSelection.summary')}
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('pageSelection.totalPages')}</span>
                <span className="font-medium text-ink">{effectiveTotal}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('pageSelection.selectedPages')}</span>
                <span className={`font-medium ${selected.size > 0 ? 'text-forest' : 'text-muted'}`}>
                  {selected.size}
                </span>
              </div>
            </div>
          </div>

          {/* Range input */}
          <div>
            <label className="text-xs font-medium text-muted uppercase tracking-widest block mb-2">
              {t('pageSelection.rangeLabel')}
            </label>
            <Input
              type="text"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              onBlur={(e) => applyRange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyRange(rangeInput)}
              placeholder={t('pageSelection.rangePlaceholder')}
              className={`py-2.5 ${rangeError ? 'border-red-300 focus:ring-red-200' : ''}`}
            />
            {rangeError && (
              <p className="text-xs text-red-500 mt-1.5">{t('pageSelection.rangeError')}</p>
            )}
            <p className="text-xs text-muted mt-1.5">{t('pageSelection.rangeHint')}</p>
          </div>

          {/* Select all / clear */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setSelected(new Set(Array.from({ length: effectiveTotal }, (_, i) => i + 1)))}
            >
              {t('pageSelection.selectAll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => setSelected(new Set())}
            >
              {t('pageSelection.clearAll')}
            </Button>
          </div>

          {/* References */}
          <div className="bg-sand/50 rounded-xl px-4 py-4">
            <p className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
              {t('project.references.title')}
            </p>
            <label
              className="flex items-start gap-2.5 cursor-pointer w-fit"
              onClick={() => setHasReferences(v => !v)}
            >
              <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                hasReferences ? 'bg-forest border-forest' : 'border-border'
              }`}>
                {hasReferences && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
              <span className="text-sm text-ink leading-snug">{t('project.references.hasSection')}</span>
            </label>

            {hasReferences && (
              <div className="flex flex-col gap-2 mt-3">
                <label className="text-xs font-medium text-muted">{t('project.references.pagesLabel')}</label>
                <Input
                  type="text"
                  value={referencesPagesInput}
                  onChange={e => setReferencesPagesInput(e.target.value)}
                  onBlur={() => {
                    if (parsedRefPages.size > 0) {
                      setReferencesPagesInput(selectionToRangeString(parsedRefPages, effectiveTotal))
                    }
                  }}
                  placeholder={t('project.references.pagesPlaceholder')}
                  className={`py-2 ${referencesPagesInput.trim() && validRefPages.size === 0 ? 'border-red-300 focus-visible:ring-red-200' : ''}`}
                />
                {referencesPagesInput.trim() && validRefPages.size === 0 && (
                  <p className="text-xs text-red-500">{t('project.references.noValidPages')}</p>
                )}

                {excludedRefPages.size > 0 && validRefPages.size > 0 && (
                  <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <AlertTriangle size={12} className="shrink-0 text-amber-600 mt-0.5" />
                    <p className="text-xs text-amber-800 leading-relaxed">
                      {t('project.references.partialWarning', {
                        pages: selectionToRangeString(excludedRefPages, effectiveTotal),
                      })}
                    </p>
                  </div>
                )}

                <p className="text-xs text-muted/80 leading-relaxed">{t('project.references.disclaimer')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Continue CTA */}
        <div className="px-6 py-5 border-t border-border">
          <Button
            variant="cta"
            size="lg"
            disabled={!canContinue}
            className="w-full font-semibold"
            onClick={() => {
              storeFile(state.file)
              navigate(ROUTES.checkout, {
                state: {
                  services: Array.from(activeServices),
                  pageCount: selected.size,
                  selectedPages: Array.from(selected).sort((a, b) => a - b),
                  guideline,
                  fileName: state.file?.name ?? null,
                  title: state.title ?? '',
                  referencePages: validRefPages.size > 0
                    ? Array.from(validRefPages).sort((a, b) => a - b)
                    : undefined,
                }
              })
            }}
          >
            {t('pageSelection.continue')}
            <span>→</span>
          </Button>
          {canContinue && (
            <p className="text-center text-xs text-muted mt-2">
              {selected.size} {selected.size === 1 ? t('pageSelection.pageCount_one') : t('pageSelection.pageCount_other')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
