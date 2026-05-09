import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Upload, Link as LinkIcon, ChevronDown, FileText, X, Clock } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { PRICING, formatBRL } from '../lib/pricing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer))
    const matches = [...text.matchAll(/\/Count\s+(\d+)/g)]
    if (matches.length > 0) return parseInt(matches[matches.length - 1][1])
  } catch { /* ignore */ }
  return null
}

async function getDocxPageCount(file: File): Promise<number | null> {
  try {
    const { unzip } = await import('fflate')
    const buffer = await file.arrayBuffer()
    return await new Promise(resolve => {
      unzip(new Uint8Array(buffer), (err, files) => {
        if (err || !files['docProps/app.xml']) { resolve(null); return }
        const xml = new TextDecoder().decode(files['docProps/app.xml'])
        const match = xml.match(/<(?:[^:>]+:)?Pages>(\d+)<\/(?:[^:>]+:)?Pages>/)
        resolve(match ? parseInt(match[1]) : null)
      })
    })
  } catch {
    return null
  }
}

async function getDocxPageCountByRender(file: File): Promise<number | null> {
  try {
    const { renderAsync } = await import('docx-preview')
    const div = document.createElement('div')
    div.style.cssText = 'position:fixed;visibility:hidden;left:-9999px;top:0;width:816px;overflow:visible;pointer-events:none;'
    document.body.appendChild(div)
    await renderAsync(file, div, undefined, { breakPages: false, inWrapper: false })
    const section = div.querySelector('section.docx') as HTMLElement
    if (!section) { document.body.removeChild(div); return null }
    section.style.overflow = 'visible'
    section.style.height = 'auto'
    const pageHeight = parseFloat(getComputedStyle(section).minHeight)
    const contentHeight = section.scrollHeight
    document.body.removeChild(div)
    return pageHeight > 0 ? Math.max(1, Math.ceil(contentHeight / pageHeight)) : null
  } catch {
    return null
  }
}

async function getFilePageCount(file: File): Promise<number | null> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return getPdfPageCount(file)
  if (name.endsWith('.docx')) {
    const xmlCount = await getDocxPageCount(file)
    if (xmlCount) return xmlCount
    return getDocxPageCountByRender(file)
  }
  return null
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
  const [pasteUrl, setPasteUrl] = useState(navState?.pasteUrl ?? saved?.pasteUrl ?? '')
  const [agreedToTerms, setAgreedToTerms] = useState(saved?.agreedToTerms ?? false)
  const [title, setTitle] = useState(navState?.title ?? saved?.title ?? '')
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
    if (!file) { setPageCount(null); return }
    setPageCountLoading(true)
    getFilePageCount(file).then(count => {
      setPageCount(count)
      setPageCountLoading(false)
    })
    setTitle(prev => prev || file.name.replace(/\.[^.]+$/, ''))
  }, [file])

  const canSubmit =
    selectedServices.size > 0 &&
    agreedToTerms &&
    (inputTab === 'upload' ? file !== null : pasteUrl.trim() !== '')

  const ALLOWED_EXTENSIONS = ['.pdf', '.docx']
  const ALLOWED_MIME_TYPES = [
    'application/pdf',
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
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {file ? (
                  /* File card */
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    className={`rounded-xl border px-4 py-4 flex items-start gap-3 transition-colors ${
                      dragging
                        ? 'border-forest-mid bg-forest-mid/5'
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
                        <span className="text-xs text-muted">
                          {pageCountLoading
                            ? t('getStarted.fileCard.countingPages')
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
                        onClick={() => { setFile(null); setPageCount(null); setFileTypeError(null) }}
                        className="text-muted hover:text-ink transition-colors p-0.5"
                        aria-label="Remove file"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
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
                      {['.pdf', '.docx'].map((ext) => (
                        <span key={ext} className={`text-xs border rounded px-2 py-0.5 ${fileTypeError ? 'border-red-300 text-red-400' : 'border-border text-muted'}`}>
                          {ext}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full rounded-xl border border-border px-4 py-4 flex flex-col justify-center gap-3">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  {t('hero.documentUrl')}
                </label>
                <Input
                  type="url"
                  placeholder="https://docs.google.com/..."
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  className="rounded-lg py-2.5"
                />
                <p className="text-xs text-muted">{t('hero.linksSupported')}</p>
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
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return
            sessionStorage.removeItem(SESSION_KEY)
            navigate(ROUTES.pageSelection, {
              state: {
                file,
                pasteUrl,
                inputTab,
                services: Array.from(selectedServices),
                guideline: selectedGuideline,
                pageCount,
                title,
              },
            })
          }}
          className="font-semibold whitespace-nowrap"
        >
          {t('getStarted.submit')}
          <span>→</span>
        </Button>
      </div>
    </div>
  )
}
