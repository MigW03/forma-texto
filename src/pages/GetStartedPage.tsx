import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Upload, Link as LinkIcon, ChevronDown, FileText, X } from 'lucide-react'
import { ROUTES } from '../lib/routes'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getExtension(name: string): string {
  return name.split('.').pop()?.toUpperCase() ?? '—'
}

async function getPdfPageCount(file: File): Promise<number | null> {
  if (!file.name.toLowerCase().endsWith('.pdf')) return null
  try {
    const buffer = await file.arrayBuffer()
    const text = new TextDecoder('latin1').decode(new Uint8Array(buffer))
    const matches = [...text.matchAll(/\/Count\s+(\d+)/g)]
    if (matches.length > 0) {
      return parseInt(matches[matches.length - 1][1])
    }
  } catch {
    // ignore parse errors
  }
  return null
}

type ServiceType = 'proofreading' | 'formatting'
type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'
type InputTab = 'upload' | 'link'

const GUIDELINE_IDS: GuidelineId[] = ['abnt', 'apa', 'mla', 'chicago']

export default function GetStartedPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [selectedServices, setSelectedServices] = useState<Set<ServiceType>>(new Set())
  const [guidelinesOpen, setGuidelinesOpen] = useState(false)
  const [selectedGuideline, setSelectedGuideline] = useState<GuidelineId>('abnt')

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
  const [inputTab, setInputTab] = useState<InputTab>('upload')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [pageCountLoading, setPageCountLoading] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) { setPageCount(null); return }
    setPageCountLoading(true)
    getPdfPageCount(file).then(count => {
      setPageCount(count)
      setPageCountLoading(false)
    })
  }, [file])

  const canSubmit =
    selectedServices.size > 0 &&
    agreedToTerms &&
    (inputTab === 'upload' ? file !== null : pasteUrl.trim() !== '')

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) setFile(dropped)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) setFile(selected)
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
            <span className="text-xs font-medium text-muted bg-[#F0EEE8] border border-border rounded-full px-2.5 py-1">
              {t('getStarted.freeBadge')} · {t('getStarted.firstPage')}
            </span>
            <span className="text-muted/40 text-xs">·</span>
            <span className="text-xs font-semibold text-ink">$29</span>
            <span className="text-xs text-muted">{t('getStarted.perThesis')}</span>
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
            <span className="text-xs font-medium text-muted bg-[#F0EEE8] border border-border rounded-full px-2.5 py-1">
              {t('getStarted.freeBadge')} · {t('getStarted.firstPage')}
            </span>
            <span className="text-muted/40 text-xs">·</span>
            <span className="text-xs font-semibold text-ink">$29</span>
            <span className="text-xs text-muted">{t('getStarted.perThesis')}</span>
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
      <div
        className={`transition-opacity duration-200 ${
          selectedServices.size > 0 ? 'opacity-100' : 'opacity-40 pointer-events-none'
        }`}
      >
        <p className="text-xs font-medium text-muted uppercase tracking-widest mb-4">
          {t('getStarted.stepDocument')}
        </p>
        <div className="bg-white rounded-2xl border border-border p-4">
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
                  accept=".docx,.pdf,.tex,.odt"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {file ? (
                  /* File card */
                  <div className="rounded-xl border border-border bg-[#F0EEE8] px-4 py-4 flex items-start gap-3">
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
                        onClick={() => { setFile(null); setPageCount(null) }}
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
                      dragging
                        ? 'border-forest-mid bg-forest-mid/5'
                        : 'border-border hover:border-forest-mid/50'
                    }`}
                  >
                    <Upload size={24} className="text-muted" strokeWidth={1.5} />
                    <p className="text-sm font-medium text-ink">{t('hero.dropPrompt')}</p>
                    <p className="text-xs text-muted">{t('hero.fileLimit')}</p>
                    <div className="flex gap-2 mt-1">
                      {['.docx', '.pdf', '.tex', '.odt'].map((ext) => (
                        <span key={ext} className="text-xs border border-border rounded px-2 py-0.5 text-muted">
                          {ext}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="h-full rounded-xl border border-border px-4 flex flex-col justify-center gap-3">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  {t('hero.documentUrl')}
                </label>
                <input
                  type="url"
                  placeholder="https://docs.google.com/..."
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2.5 bg-[#F0EEE8] focus:outline-none focus:ring-2 focus:ring-forest-mid/30"
                />
                <p className="text-xs text-muted">{t('hero.linksSupported')}</p>
              </div>
            )}
          </div>

        </div>
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
          <Link to={ROUTES.terms} target="_blank" className="text-ink underline underline-offset-2 hover:text-forest transition-colors">
            {t('getStarted.termsLink')}
          </Link>{' '}
          {t('getStarted.termsAnd')}{' '}
          <Link to={ROUTES.privacy} target="_blank" className="text-ink underline underline-offset-2 hover:text-forest transition-colors">
            {t('getStarted.privacyLink')}
          </Link>
          .
        </p>
      </label>

      {/* CTA */}
      <div className="mt-6 pt-6 border-t border-border flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{t('hero.freeFirstPage')}</p>
          <p className="text-xs text-muted mt-0.5">{t('getStarted.ctaSubtitle')}</p>
        </div>
        <button
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return
            navigate(ROUTES.pageSelection, {
              state: {
                file,
                pasteUrl,
                inputTab,
                services: Array.from(selectedServices),
                guideline: selectedGuideline,
                pageCount,
              },
            })
          }}
          className={`flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-xl transition-all whitespace-nowrap bg-forest text-white ${
            canSubmit
              ? 'hover:bg-forest-mid cursor-pointer opacity-100'
              : 'opacity-40 cursor-not-allowed'
          }`}
        >
          {t('getStarted.submit')}
          <span>→</span>
        </button>
      </div>
    </div>
  )
}
