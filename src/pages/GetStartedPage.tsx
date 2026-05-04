import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, Upload, Link as LinkIcon } from 'lucide-react'
import { ROUTES } from '../lib/routes'

type ServiceType = 'proofreading' | 'formatting'
type GuidelineId = 'abnt' | 'apa' | 'mla' | 'chicago'
type InputTab = 'upload' | 'link'

const GUIDELINE_IDS: GuidelineId[] = ['abnt', 'apa', 'mla', 'chicago']

export default function GetStartedPage() {
  const { t } = useTranslation()
  const [selectedService, setSelectedService] = useState<ServiceType | null>(null)
  const [selectedGuideline, setSelectedGuideline] = useState<GuidelineId>('abnt')
  const [inputTab, setInputTab] = useState<InputTab>('upload')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canSubmit =
    selectedService !== null &&
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start mb-8">
        {/* Proofreading card */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setSelectedService('proofreading')}
          onKeyDown={(e) => e.key === 'Enter' && setSelectedService('proofreading')}
          className={`rounded-2xl border-2 p-6 flex flex-col gap-4 cursor-pointer transition-all ${
            selectedService === 'proofreading'
              ? 'border-forest bg-forest/[0.03]'
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
            {selectedService === 'proofreading' && (
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
          onClick={() => setSelectedService('formatting')}
          onKeyDown={(e) => e.key === 'Enter' && setSelectedService('formatting')}
          className={`rounded-2xl border-2 p-6 flex flex-col gap-4 cursor-pointer transition-all ${
            selectedService === 'formatting'
              ? 'border-forest bg-forest/[0.03]'
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
            {selectedService === 'formatting' && (
              <div className="shrink-0 w-5 h-5 rounded-full bg-forest flex items-center justify-center">
                <Check size={11} className="text-white" />
              </div>
            )}
          </div>

          {selectedService === 'formatting' && (
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
                    <p
                      className={`text-xs mt-0.5 ${
                        selectedGuideline === id ? 'text-white/70' : 'text-muted'
                      }`}
                    >
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
          </div>
        </div>
      </div>

      {/* Step 2: Document input */}
      <div
        className={`transition-opacity duration-200 ${
          selectedService ? 'opacity-100' : 'opacity-40 pointer-events-none'
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

          <div className="h-48">
            {inputTab === 'upload' ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`h-full rounded-xl border-2 border-dashed cursor-pointer flex flex-col items-center justify-center gap-3 transition-colors ${
                  dragging
                    ? 'border-forest-mid bg-forest-mid/5'
                    : 'border-border hover:border-forest-mid/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.pdf,.tex,.odt"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Upload size={24} className="text-muted" strokeWidth={1.5} />
                {file ? (
                  <p className="text-sm font-medium text-ink">{file.name}</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-ink">{t('hero.dropPrompt')}</p>
                    <p className="text-xs text-muted">{t('hero.fileLimit')}</p>
                  </>
                )}
                <div className="flex gap-2 mt-1">
                  {['.docx', '.pdf', '.tex', '.odt'].map((ext) => (
                    <span
                      key={ext}
                      className="text-xs border border-border rounded px-2 py-0.5 text-muted"
                    >
                      {ext}
                    </span>
                  ))}
                </div>
              </div>
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

          <div className="flex items-center justify-between mt-4">
            <span className="text-xs text-muted">{t('hero.freeFirstPage')}</span>
            <button
              disabled={!canSubmit}
              className={`flex items-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors ${
                canSubmit
                  ? 'bg-forest text-white hover:bg-forest-mid cursor-pointer'
                  : 'bg-[#F0EEE8] text-muted cursor-not-allowed'
              }`}
            >
              {t('getStarted.submit')}
              <span className="text-xs">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
