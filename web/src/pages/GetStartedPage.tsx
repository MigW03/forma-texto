import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Upload, Link as LinkIcon, ChevronDown, FileText, X, Clock, Loader2 } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { supabase } from '../lib/supabase'
import { PRICING, formatBRL, type ServiceKey } from '../lib/pricing'
import { getLaudas } from '../lib/laudas'
import { decodeFilename } from '../lib/filename'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGuidelines, localizedDescription } from '../lib/guidelines'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExtension(name: string): string {
  return name.split('.').pop()?.toUpperCase() ?? '—'
}

/**
 * Lauda count for the price estimate. We bill by laudas (~300-word units), which
 * are always derivable from a `.docx`'s text — so there is no "uncountable" case.
 * Returns null only when the file isn't a `.docx` or can't be parsed.
 */
async function getLaudaCount(file: File): Promise<number | null> {
  if (!file.name.toLowerCase().endsWith('.docx')) return null
  try {
    return (await getLaudas(file)).length
  } catch {
    return null
  }
}

type GuidelineId = string
type InputTab = 'upload' | 'link'

export const SESSION_KEY = 'forma-texto-get-started'

function loadSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as {
      services: ServiceKey[]
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
  services: ServiceKey[]
  guideline: GuidelineId
  pageCount: number | null
  title: string
}

export default function GetStartedPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  // Navigation state (coming back from PageSelectionPage) takes priority over sessionStorage
  const navState = location.state as RestoredState | null
  const saved = navState ? null : loadSession()

  const initServices = navState?.services ?? saved?.services ?? []
  const initGuideline = (navState?.guideline ?? saved?.guideline ?? 'abnt') as GuidelineId
  const initTab = (navState?.inputTab ?? saved?.inputTab ?? 'upload') as InputTab

  const [selectedServices, setSelectedServices] = useState<Set<ServiceKey>>(
    () => new Set(initServices)
  )
  const [guidelinesOpen, setGuidelinesOpen] = useState(
    () => initServices.includes('formatting')
  )
  const [selectedGuideline, setSelectedGuideline] = useState<GuidelineId>(initGuideline)
  const guidelines = useGuidelines()

  // If the saved/selected guideline isn't in the loaded catalog, snap to the first.
  useEffect(() => {
    if (guidelines.length && !guidelines.some(g => g.id === selectedGuideline)) {
      setSelectedGuideline(guidelines[0].id)
    }
  }, [guidelines, selectedGuideline])

  const toggleService = (service: ServiceKey) => {
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
  const [fetchingLink, setFetchingLink] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)
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
    getLaudaCount(file).then(count => {
      setPageCount(count)
      setPageCountLoading(false)
    })
    setTitle(prev => prev || file.name.replace(/\.[^.]+$/, ''))
  }, [file])

  const canSubmit =
    selectedServices.size > 0 &&
    agreedToTerms &&
    (inputTab === 'upload'
      ? file !== null && !pageCountLoading
      : pasteUrl.trim() !== '')

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
          <ArrowLeft size={14} aria-hidden="true" />
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
          aria-pressed={selectedServices.has('proofreading')}
          onClick={() => toggleService('proofreading')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleService('proofreading')
            }
          }}
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
                <Check size={11} className="text-white" aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-border flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink">
              {formatBRL(PRICING.proofreading.perPage)}/{t('laudas.unit')}
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
          aria-pressed={selectedServices.has('formatting')}
          onClick={() => toggleService('formatting')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              toggleService('formatting')
            }
          }}
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
                <Check size={11} className="text-white" aria-hidden="true" />
              </div>
            )}
          </div>

          {guidelinesOpen && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted uppercase tracking-widest">
                {t('getStarted.guidelineLabel')}
              </p>
              {guidelines.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={selectedGuideline === g.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedGuideline(g.id) }}
                  className={`flex items-center justify-between rounded-xl px-3 py-3 text-left transition-colors ${
                    selectedGuideline === g.id
                      ? 'bg-forest text-white'
                      : 'border border-border hover:border-forest-mid/40 text-ink'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">
                      {g.name}
                    </p>
                    <p className={`text-xs mt-0.5 ${selectedGuideline === g.id ? 'text-white/70' : 'text-muted'}`}>
                      {localizedDescription(g.description, i18n.language)}
                    </p>
                  </div>
                  {selectedGuideline === g.id && (
                    <Check size={14} className="shrink-0 ml-3" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="pt-3 border-t border-border flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-ink">
              {formatBRL(PRICING.formatting.perPage)}/{t('laudas.unit')}
            </span>
            <span className="text-xs text-muted">
              · mín. {formatBRL(PRICING.formatting.minimum)}
            </span>
            <button
              type="button"
              aria-expanded={guidelinesOpen}
              onClick={(e) => { e.stopPropagation(); setGuidelinesOpen(o => !o) }}
              className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-ink transition-colors"
            >
              {t('getStarted.guidelineLabel')}
              <ChevronDown
                size={14}
                aria-hidden="true"
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
          <div role="tablist" className="flex rounded-lg border border-border overflow-hidden mb-4">
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === 'upload'}
              onClick={() => setInputTab('upload')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                inputTab === 'upload' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <Upload size={14} aria-hidden="true" />
              {t('hero.uploadTab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={inputTab === 'link'}
              onClick={() => setInputTab('link')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                inputTab === 'link' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <LinkIcon size={14} aria-hidden="true" />
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
                        : 'border-border bg-[#F0EEE8]'
                    }`}
                  >
                    <div className="shrink-0 w-9 h-9 rounded-lg bg-white border border-border flex items-center justify-center">
                      <FileText size={16} className="text-forest" strokeWidth={1.5} aria-hidden="true" />
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
                            ? t('getStarted.fileCard.countingLaudas')
                            : pageCount !== null
                              ? `${pageCount} ${pageCount === 1 ? t('laudas.lauda_one') : t('laudas.lauda_other')}`
                              : t('getStarted.fileCard.laudasUnknown')}
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
                        type="button"
                        onClick={() => { setFile(null); setPageCount(null); setFileTypeError(null) }}
                        className="text-muted hover:text-ink transition-colors p-0.5"
                        aria-label={t('getStarted.fileCard.remove')}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
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
                    <Upload size={24} className={fileTypeError ? 'text-red-400' : 'text-muted'} strokeWidth={1.5} aria-hidden="true" />
                    <p className="text-sm font-medium text-ink">{t('hero.dropPrompt')}</p>
                    {fileTypeError === 'doc' ? (
                      <p role="alert" className="text-xs text-red-500 text-center px-6">{t('getStarted.fileCard.docConvert')}</p>
                    ) : fileTypeError === 'invalid' ? (
                      <p role="alert" className="text-xs text-red-500 text-center px-6">{t('getStarted.fileCard.invalidType')}</p>
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
                <Loader2 size={20} className="text-forest animate-spin" aria-hidden="true" />
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
                  onChange={(e) => { setPasteUrl(e.target.value); setLinkError(null) }}
                  className="rounded-lg py-2.5"
                />
                {linkError ? (
                  <p role="alert" className="text-xs text-red-500">{linkError}</p>
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
        <Clock size={13} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
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
            <Check size={10} className="absolute inset-0 m-auto text-white pointer-events-none" aria-hidden="true" />
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

            let resolvedFile = file
            let resolvedPageCount = pageCount

            if (inputTab === 'link') {
              setFetchingLink(true)
              try {
                const linkToken = (await supabase.auth.getSession()).data.session?.access_token
                const res = await fetch(`${API_URL}/api/documents/fetch?url=${encodeURIComponent(pasteUrl)}`, {
                  headers: linkToken ? { Authorization: `Bearer ${linkToken}` } : {},
                })
                if (!res.ok) {
                  const data = await res.json()
                  setLinkError(data.error ?? 'Failed to fetch document')
                  setFetchingLink(false)
                  return
                }
                const blob = await res.blob()
                const filename = decodeFilename(res.headers.get('X-Filename'))
                resolvedFile = new File([blob], filename, { type: blob.type })
                // Scan the fetched .docx into laudas (word-based — page metadata is irrelevant).
                resolvedPageCount = await getLaudaCount(resolvedFile)
                if (!title) setTitle(filename.replace(/\.[^.]+$/, ''))
              } catch {
                setLinkError('Could not connect to server')
                setFetchingLink(false)
                return
              }
              // Don't reset fetchingLink here — keep the loading state visible
              // until navigation unmounts the component. Resetting it before
              // navigate() causes a brief flash back to the input.
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
