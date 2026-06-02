import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Upload, Link as LinkIcon, ChevronDown, FileText, X, Clock, Loader2, AlertTriangle } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { PRICING, formatBRL } from '../lib/pricing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExtension(name: string): string {
  return name.split('.').pop()?.toUpperCase() ?? '—'
}

async function getPdfPageCount(file: File): Promise<number | null> {
  try {
    const buffer = await file.arrayBuffer()
    const pdfjsLib = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
    const count = doc.numPages
    doc.destroy()
    return count
  } catch { /* ignore */ }
  return null
}

/**
 * Page count plus a reliability flag.
 *
 * Counting strategy, strongest signal first:
 *   1. `<Pages>` in docProps/app.xml — editor cached a real count.
 *   2. `lastRenderedPageBreak` markers — Word cached its layout.
 *   3. Otherwise count by breaks (explicit page breaks + pageBreakBefore +
 *      section breaks) and sanity-check it against content volume.
 *
 * The sanity check catches the dangerous case: a file whose breaks under-count
 * its real pages because the text flows across more pages than there are breaks
 * (e.g. a long thesis exported by a converter that dropped page boundaries).
 * If the text-per-detected-page is physically impossible for a single page, the
 * count can't be trusted and the upload blocks rather than guess. Files with
 * breaks that match their content (normal Google Docs exports, short docs) pass.
 */
export interface FilePageInfo {
  count: number | null
  reliable: boolean
}

// A page physically holds at most ~3.5k characters; well above this per
// detected page means the text overflows the breaks → count is too low.
const MAX_CHARS_PER_PAGE = 3500

async function getDocxPageInfo(file: File): Promise<FilePageInfo> {
  try {
    const { unzip } = await import('fflate')
    const buffer = await file.arrayBuffer()
    const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
      unzip(new Uint8Array(buffer), (err, f) => (err ? reject(err) : resolve(f)))
    )
    const decoder = new TextDecoder()
    const appXml = files['docProps/app.xml'] ? decoder.decode(files['docProps/app.xml']) : ''
    const docXml = files['word/document.xml'] ? decoder.decode(files['word/document.xml']) : ''
    if (!docXml) return { count: null, reliable: false }

    const appMatch = appXml.match(/<(?:[^:>]+:)?Pages>(\d+)<\/(?:[^:>]+:)?Pages>/)
    const appPages = appMatch ? parseInt(appMatch[1], 10) : 0
    const lastRendered = (docXml.match(/<w:lastRenderedPageBreak/g) ?? []).length
    const explicitBreaks = (docXml.match(/w:type=["']page["']/g) ?? []).length

    // 1. A stored page count is the strongest signal.
    if (appPages > 0) return { count: appPages, reliable: true }
    // 2. Word's cached layout markers are reliable too.
    if (lastRendered > 0) return { count: Math.max(lastRendered, explicitBreaks) + 1, reliable: true }

    // 3. Count by breaks, then verify the content fits.
    const pageBreakBefore = (docXml.match(/<w:pageBreakBefore/g) ?? []).length
    const sectionBreaks = Math.max(0, (docXml.match(/<w:sectPr/g) ?? []).length - 1)
    const detectedPages = explicitBreaks + pageBreakBefore + sectionBreaks + 1

    const textChars = (docXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
      .reduce((sum, seg) => sum + seg.replace(/<[^>]+>/g, '').length, 0)
    const charsPerPage = textChars / detectedPages

    // Overflowing the detected pages means the count is too low to trust.
    if (charsPerPage > MAX_CHARS_PER_PAGE) return { count: null, reliable: false }
    return { count: detectedPages, reliable: true }
  } catch {
    return { count: null, reliable: false }
  }
}

async function getFilePageInfo(file: File): Promise<FilePageInfo> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) {
    const count = await getPdfPageCount(file)
    return { count, reliable: count !== null }
  }
  if (name.endsWith('.docx')) return getDocxPageInfo(file)
  return { count: null, reliable: false }
}

type ServiceType = 'proofreading' | 'formatting'
type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'
type InputTab = 'upload' | 'link'

const GUIDELINE_IDS: GuidelineId[] = ['abnt', 'apa', 'mla', 'chicago']
export const SESSION_KEY = 'forma-texto-get-started'

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as {
      services: ServiceType[]
      guideline: GuidelineId
      inputTab: InputTab
      pasteUrl: string
      agreedToTerms: boolean
      title: string
    }
  } catch {
    return null
  }
}

type RestoredState = {
  file: File | null
  pasteUrl: string
  inputTab: InputTab
  services: ServiceType[]
  guideline: GuidelineId
  pageCount: number | null
  title: string
}

export default function GetStartedPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  // Navigation state (coming back from PageSelectionPage) takes priority over sessionStorage
  const navState = location.state as RestoredState | null
  const saved = navState ? null : loadSession()

  const initServices = navState?.services ?? saved?.services ?? []
  const initGuideline = (navState?.guideline ?? saved?.guideline ?? 'abnt') as GuidelineId
  const initTab = (navState?.inputTab ?? saved?.inputTab ?? 'upload') as InputTab

  const [selectedServices, setSelectedServices] = useState<Set<ServiceType>>(
    () => new Set(initServices)
  )
  const [guidelinesOpen, setGuidelinesOpen] = useState(
    () => initServices.includes('formatting')
  )
  const [selectedGuideline, setSelectedGuideline] = useState<GuidelineId>(initGuideline)

  const toggleService = (service: ServiceType) => {
    setSelectedServices(prev => {
      const next = new Set(prev)
      if (next.has(service)) {
        next.delete(service)
        if (service === 'formatting') setGuidelinesOpen(false)
      } else {
        next.add(service)
        if (service === 'formatting') setGuidelinesOpen(true)
      }
      return next
    })
  }
  const [inputTab, setInputTab] = useState<InputTab>(initTab)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(navState?.file ?? null)
  const [fileTypeError, setFileTypeError] = useState<'doc' | 'invalid' | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(navState?.pageCount ?? null)
  const [pageCountLoading, setPageCountLoading] = useState(false)
  const [countReliable, setCountReliable] = useState(true)
  const [pasteUrl, setPasteUrl] = useState(navState?.pasteUrl ?? saved?.pasteUrl ?? '')
  const [agreedToTerms, setAgreedToTerms] = useState(saved?.agreedToTerms ?? false)
  const [title, setTitle] = useState(navState?.title ?? saved?.title ?? '')
  const [fetchingLink, setFetchingLink] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linkUncountable, setLinkUncountable] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Persist serializable state on every change
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      services: Array.from(selectedServices),
      guideline: selectedGuideline,
      inputTab,
      pasteUrl,
      agreedToTerms,
      title,
    }))
  }, [selectedServices, selectedGuideline, inputTab, pasteUrl, agreedToTerms, title])

  useEffect(() => {
    if (!file) { setPageCount(null); setCountReliable(true); return }
    setPageCountLoading(true)
    getFilePageInfo(file).then(info => {
      setPageCount(info.count)
      setCountReliable(info.reliable)
      setPageCountLoading(false)
    })
    setTitle(prev => prev || file.name.replace(/\.[^.]+$/, ''))
  }, [file])

  const canSubmit =
    selectedServices.size > 0 &&
    agreedToTerms &&
    (inputTab === 'upload'
      ? file !== null && !pageCountLoading && countReliable
      : pasteUrl.trim() !== '' && !linkUncountable)

  const ALLOWED_EXTENSIONS = ['.docx']
  const ALLOWED_MIME_TYPES = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]

  const isDocFile = (f: File) => f.name.toLowerCase().endsWith('.doc') && !f.name.toLowerCase().endsWith('.docx')
  const isAllowedFile = (f: File) => {
    const ext = '.' + f.name.split('.').pop()?.toLowerCase()
    return ALLOWED_EXTENSIONS.includes(ext) || ALLOWED_MIME_TYPES.includes(f.type)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (!dropped) return
    if (isDocFile(dropped)) { setFileTypeError('doc'); return }
    if (!isAllowedFile(dropped)) { setFileTypeError('invalid'); return }
    setFileTypeError(null)
    setFile(dropped)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return
    if (isDocFile(selected)) { setFileTypeError('doc'); e.target.value = ''; return }
    if (!isAllowedFile(selected)) { setFileTypeError('invalid'); e.target.value = ''; return }
    setFileTypeError(null)
    setFile(selected)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-8">
        <Link
          to={ROUTES.dashboard}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-4"
        >
          <ArrowLeft size={14} />
          {t('getStarted.backToDashboard')}
        </Link>
        <h1 className="text-2xl font-semibold text-ink">{t('getStarted.title')}</h1>
        <p className="text-sm text-muted mt-1">{t('getStarted.subtitle')}</p>
      </div>

      {/* Step 1: Service selection */}
      <p className="text-xs font-medium text-muted uppercase tracking-widest mb-4">
        {t('getStarted.stepService')}
      </p>
      <div className="flex flex-col gap-4 mb-8">
        {/* Proofreading card */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleService('proofreading')}
          onKeyDown={(e) => e.key === 'Enter' && toggleService('proofreading')}
          className={`rounded-2xl border-2 p-6 flex flex-col gap-4 cursor-pointer transition-all ${
            selectedServices.has('proofreading')
              ? 'border-forest bg-forest/[0.07]'
              : 'border-border bg-white hover:border-forest-mid/40'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs font-medium text-muted tracking-widest uppercase mb-2">
                <span className="text-forest-light">01</span>&nbsp;
                {t('services.proofreading.label')}
              </p>
              <p className="text-base font-semibold text-ink leading-snug">
                {t('services.proofreading.title1')}{' '}
                <em className="font-serif font-normal italic text-forest-mid">
                  {t('services.proofreading.title2')}
                </em>
              </p>
              <p className="text-sm text-muted mt-2 leading-relaxed">
                {t('services.proofreading.description')}
              </p>
            </div>
            {selectedServices.has('proofreading') && (
              <div className="shrink-0 w-5 h-5 rounded-full bg-forest flex items-center justify-center">
                <Check size={11} className="text-white" />
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-border flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink">
              {formatBRL(PRICING.proofreading.perPage)}/pg
            </span>
            <span className="text-xs text-muted">
              · mín. {formatBRL(PRICING.proofreading.minimum)}
            </span>
          </div>
        </div>

        {/* Formatting card */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleService('formatting')}
          onKeyDown={(e) => e.key === 'Enter' && toggleService('formatting')}
          className={`rounded-2xl border-2 p-6 flex flex-col gap-4 cursor-pointer transition-all ${
            selectedServices.has('formatting')
              ? 'border-forest bg-forest/[0.07]'
              : 'border-border bg-white hover:border-forest-mid/40'
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <p className="text-xs font-medium text-muted tracking-widest uppercase mb-2">
                <span className="text-forest-light">02</span>&nbsp;
                {t('services.formatting.label')}
              </p>
              <p className="text-base font-semibold text-ink leading-snug">
                {t('services.formatting.title1')}{' '}
                <em className="font-serif font-normal italic text-forest-mid">
                  {t('services.formatting.title2')}
                </em>
              </p>
              <p className="text-sm text-muted mt-2 leading-relaxed">
                {t('services.formatting.description')}
              </p>
            </div>
            {selectedServices.has('formatting') && (
              <div className="shrink-0 w-5 h-5 rounded-full bg-forest flex items-center justify-center">
                <Check size={11} className="text-white" />
              </div>
            )}
          </div>

          {guidelinesOpen && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted uppercase tracking-widest">
                {t('getStarted.guidelineLabel')}
              </p>
              {GUIDELINE_IDS.map((id) => (
                <button
                  key={id}
                  onClick={(e) => { e.stopPropagation(); setSelectedGuideline(id) }}
                  className={`flex items-center justify-between rounded-xl px-3 py-3 text-left transition-colors ${
                    selectedGuideline === id
                      ? 'bg-forest text-white'
                      : 'border border-border hover:border-forest-mid/40 text-ink'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {t(`services.guidelines.${id}.name`)}
                    </p>
                    <p className={`text-xs mt-0.5 ${selectedGuideline === id ? 'text-white/70' : 'text-muted'}`}>
                      {t(`services.guidelines.${id}.description`)}
                    </p>
                  </div>
                  {selectedGuideline === id && (
                    <Check size={14} className="shrink-0 ml-3" />
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-border flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink">
              {formatBRL(PRICING.formatting.perPage)}/pg
            </span>
            <span className="text-xs text-muted">
              · mín. {formatBRL(PRICING.formatting.minimum)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setGuidelinesOpen(o => !o) }}
              className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors"
            >
              {t('getStarted.guidelineLabel')}
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${guidelinesOpen ? 'rotate-180' : ''}`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Step 2: Document input */}
      <div>
        <p className="text-xs font-medium text-muted uppercase tracking-widest mb-4">
          {t('getStarted.stepDocument')}
        </p>
        <div className="bg-white rounded-2xl border border-border p-4">
          {/* Project title */}
          <div className="mb-4">
            <label className="text-xs font-medium text-muted uppercase tracking-widest block mb-1.5">
              {t('getStarted.projectTitle')}
            </label>
            <Input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('getStarted.projectTitlePlaceholder')}
              className="py-2.5"
            />
          </div>

          {/* Tab switcher */}
          <div className="flex rounded-lg border border-border overflow-hidden mb-4">
            <button
              onClick={() => setInputTab('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                inputTab === 'upload' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <Upload size={14} />
              {t('hero.uploadTab')}
            </button>
            <button
              onClick={() => setInputTab('link')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                inputTab === 'link' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <LinkIcon size={14} />
              {t('hero.linkTab')}
            </button>
          </div>

          <div>
            {inputTab === 'upload' ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {file ? (
                  <>
                  {/* File card */}
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    className={`rounded-xl border px-4 py-4 flex items-start gap-3 transition-colors ${
                      dragging
                        ? 'border-forest-mid bg-forest-mid/5'
                        : !pageCountLoading && !countReliable
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-border bg-[#F0EEE8]'
                    }`}
                  >
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-white border border-border flex items-center justify-center">
                      <FileText size={16} className="text-forest" strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{file.name}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-xs text-muted">{formatFileSize(file.size)}</span>
                        <span className="text-muted/40 text-xs">·</span>
                        <span className="text-xs font-medium text-muted bg-white border border-border rounded px-1.5 py-0.5">
                          {getExtension(file.name)}
                        </span>
                        <span className="text-muted/40 text-xs">·</span>
                        <span className={`text-xs ${!pageCountLoading && !countReliable ? 'text-amber-700 font-medium' : 'text-muted'}`}>
                          {pageCountLoading
                            ? t('getStarted.fileCard.countingPages')
                            : !countReliable
                              ? t('getStarted.fileCard.pageCountUnavailable')
                              : pageCount !== null
                                ? `${pageCount} ${t('getStarted.fileCard.pages')}`
                                : t('getStarted.fileCard.pagesUnknown')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-muted hover:text-ink transition-colors underline underline-offset-2"
                      >
                        {t('getStarted.fileCard.replace')}
                      </button>
                      <button
                        onClick={() => { setFile(null); setPageCount(null); setCountReliable(true); setFileTypeError(null) }}
                        className="text-muted hover:text-ink transition-colors p-0.5"
                        aria-label="Remove file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  {!pageCountLoading && !countReliable && (
                    <div className="mt-3 flex gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                      <AlertTriangle size={15} className="shrink-0 text-amber-600 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-amber-800">
                          {t('getStarted.fileCard.uncountableTitle')}
                        </p>
                        <p className="text-xs text-amber-700 leading-relaxed mt-0.5">
                          {t('getStarted.fileCard.uncountableBody')}
                        </p>
                      </div>
                    </div>
                  )}
                  </>
                ) : (
                  /* Drop zone */
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`h-48 rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-3 transition-colors ${
                      fileTypeError
                        ? 'border-red-400 bg-red-50'
                        : dragging
                          ? 'border-forest-mid bg-forest-mid/5'
                          : 'border-border hover:border-forest-mid/50'
                    }`}
                  >
                    <Upload size={24} className={fileTypeError ? 'text-red-400' : 'text-muted'} strokeWidth={1.5} />
                    <p className="text-sm font-medium text-ink">{t('hero.dropPrompt')}</p>
                    {fileTypeError === 'doc' ? (
                      <p className="text-xs text-red-500 text-center px-6">{t('getStarted.fileCard.docConvert')}</p>
                    ) : fileTypeError === 'invalid' ? (
                      <p className="text-xs text-red-500 text-center px-6">{t('getStarted.fileCard.invalidType')}</p>
                    ) : (
                      <p className="text-xs text-muted">{t('hero.fileLimit')}</p>
                    )}
                    <div className="flex gap-2 mt-1">
                      <span className={`text-xs border rounded px-2 py-0.5 ${fileTypeError ? 'border-red-300 text-red-400' : 'border-border text-muted'}`}>
                        .docx
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : fetchingLink ? (
              <div className="h-32 rounded-xl border border-border bg-[#F0EEE8] flex flex-col items-center justify-center gap-3">
                <Loader2 size={20} className="text-forest animate-spin" />
                <p className="text-sm font-medium text-ink">{t('getStarted.fetchingDocument')}</p>
                <p className="text-xs text-muted">Google Docs → .docx</p>
              </div>
            ) : (
              <div className="h-full rounded-xl border border-border px-4 py-4 flex flex-col justify-center gap-3">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  {t('hero.documentUrl')}
                </label>
                <Input
                  type="url"
                  placeholder="https://docs.google.com/..."
                  value={pasteUrl}
                  onChange={(e) => { setPasteUrl(e.target.value); setLinkError(null); setLinkUncountable(false) }}
                  className="rounded-lg py-2.5"
                />
                {linkUncountable ? (
                  <div className="flex gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                    <AlertTriangle size={15} className="shrink-0 text-amber-600 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-800">
                        {t('getStarted.fileCard.uncountableTitle')}
                      </p>
                      <p className="text-xs text-amber-700 leading-relaxed mt-0.5">
                        {t('getStarted.fileCard.uncountableBody')}
                      </p>
                    </div>
                  </div>
                ) : linkError ? (
                  <p className="text-xs text-red-500">{linkError}</p>
                ) : (
                  <p className="text-xs text-muted">{t('hero.linksSupported')}</p>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* File deletion notice */}
      <div className="mt-4 flex items-start gap-2.5">
        <Clock size={13} className="text-muted shrink-0 mt-0.5" />
        <p className="text-xs text-muted leading-relaxed">
          {t('getStarted.fileDeletionNotice')}{' '}
          <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2 hover:text-forest transition-colors">
            {t('getStarted.termsLink')}
          </a>
          .
        </p>
      </div>

      {/* Terms */}
      <label className="mt-6 flex items-start gap-3 cursor-pointer group">
        <div className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="peer sr-only"
          />
          <div className="w-4 h-4 rounded border border-border bg-white peer-checked:bg-forest peer-checked:border-forest transition-colors group-hover:border-forest-mid/60" />
          {agreedToTerms && (
            <Check size={10} className="absolute inset-0 m-auto text-white pointer-events-none" />
          )}
        </div>
        <p className="text-xs text-muted leading-relaxed">
          {t('getStarted.termsPrefix')}{' '}
          <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2 hover:text-forest transition-colors">
            {t('getStarted.termsLink')}
          </a>{' '}
          {t('getStarted.termsAnd')}{' '}
          <a href={ROUTES.privacy} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2 hover:text-forest transition-colors">
            {t('getStarted.privacyLink')}
          </a>
          .
        </p>
      </label>

      {/* CTA */}
      <div className="mt-6 pt-6 border-t border-border flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{t('hero.freeFirstPage')}</p>
          <p className="text-xs text-muted mt-0.5">{t('getStarted.ctaSubtitle')}</p>
        </div>
        <Button
          variant="cta"
          size="lg"
          disabled={!canSubmit || fetchingLink}
          onClick={async () => {
            if (!canSubmit || fetchingLink) return
            setLinkError(null)
            setLinkUncountable(false)

            let resolvedFile = file
            let resolvedPageCount = pageCount

            if (inputTab === 'link') {
              setFetchingLink(true)
              try {
                const res = await fetch(`${API_URL}/api/documents/fetch?url=${encodeURIComponent(pasteUrl)}`)
                if (!res.ok) {
                  const data = await res.json()
                  setLinkError(data.error ?? 'Failed to fetch document')
                  setFetchingLink(false)
                  return
                }
                const blob = await res.blob()
                const filename = res.headers.get('X-Filename') ?? 'document.docx'
                resolvedFile = new File([blob], filename, { type: blob.type })
                const info = await getFilePageInfo(resolvedFile)
                if (!info.reliable) {
                  // Converted file's page count can't be trusted — show the same
                  // warning banner as the file-upload path and stop.
                  setLinkUncountable(true)
                  setFetchingLink(false)
                  return
                }
                resolvedPageCount = info.count
                if (!title) setTitle(filename.replace(/\.[^.]+$/, ''))
              } catch {
                setLinkError('Could not connect to server')
                setFetchingLink(false)
                return
              }
              setFetchingLink(false)
            }

            sessionStorage.removeItem(SESSION_KEY)
            navigate(ROUTES.pageSelection, {
              state: {
                file: resolvedFile,
                pasteUrl,
                inputTab,
                services: Array.from(selectedServices),
                guideline: selectedGuideline,
                pageCount: resolvedPageCount,
                title,
              },
            })
          }}
          className="font-semibold whitespace-nowrap"
        >
          {fetchingLink ? t('getStarted.fetchingDocument') : t('getStarted.submit')}
          {!fetchingLink && <span>→</span>}
        </Button>
      </div>
    </div>
  )
}
