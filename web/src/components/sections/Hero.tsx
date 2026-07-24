import { useState, useRef } from 'react'
import { Upload, Link, GraduationCap } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'
import { storeFile, HERO_UPLOAD_KEY, HERO_HANDOFF_KEY } from '../../lib/file-store'

type Tab = 'upload' | 'link'

export default function Hero() {
  const [tab, setTab] = useState<Tab>('upload')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { t } = useTranslation()

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

  const handleStartEditing = async () => {
    // Hero only ever renders for a logged-out visitor (HomeRoute sends signed-in users
    // straight to /dashboard), so this always hits ProtectedRoute's redirect to
    // /sign-in — which drops `location.state` entirely. Persist through the durable
    // handoff channel GetStartedPage reads on mount instead: IndexedDB for the File
    // (sessionStorage can't hold one), a dedicated sessionStorage key for the rest —
    // both survive the sign-in/sign-up round trip. Written unconditionally (even with
    // no file/link yet) so its mere presence signals AuthPage/HomeRoute to land the
    // user back on /get-started instead of /dashboard after they authenticate.
    if (tab === 'upload' && file) {
      await storeFile(file, HERO_UPLOAD_KEY)
    }
    sessionStorage.setItem(HERO_HANDOFF_KEY, JSON.stringify({
      inputTab: tab,
      pasteUrl: tab === 'link' ? pasteUrl : '',
    }))
    navigate(ROUTES.getStarted)
  }

  return (
    <section className="max-w-6xl mx-auto px-6 pt-20 pb-28 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
      {/* Left copy */}
      <div>
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-forest bg-forest/10 border border-forest/20 rounded-full px-2.5 py-1 mb-6">
          <GraduationCap size={12} aria-hidden="true" />
          {t('hero.tagline')}
        </span>

        <h1 className="text-5xl lg:text-6xl font-semibold text-ink leading-tight tracking-tight mb-4">
          {t('hero.title1')}
          <br />
          <em className="font-serif font-normal not-italic text-forest-mid italic">
            {t('hero.title2')}
          </em>
        </h1>

        <p className="text-base text-muted leading-relaxed max-w-md mb-8">
          {t('hero.description')}
        </p>

        <div className="flex items-center gap-2 text-xs text-muted">
          <span>{t('hero.guidelinesList')}</span>
          <span className="w-1 h-1 rounded-full bg-muted inline-block" />
          <span>{t('hero.yourTextStays')}</span>
        </div>
      </div>

      {/* Right upload card */}
      <div className="bg-white rounded-2xl border border-border shadow-sm p-4">
        {/* Tab switcher */}
        <div className="flex rounded-lg border border-border overflow-hidden mb-4">
          <button
            onClick={() => setTab('upload')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              tab === 'upload' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            <Upload size={14} />
            {t('hero.uploadTab')}
          </button>
          <button
            onClick={() => setTab('link')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
              tab === 'link' ? 'bg-[#F0EEE8] text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            <Link size={14} />
            {t('hero.linkTab')}
          </button>
        </div>

        <div className="h-52">
          {tab === 'upload' ? (
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
                accept=".docx"
                className="hidden"
                onChange={handleFileChange}
              />
              <Upload size={28} className="text-muted" strokeWidth={1.5} />
              {file ? (
                <p className="text-sm font-medium text-ink">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">
                    {t('hero.dropPrompt')}
                  </p>
                  <p className="text-xs text-muted">
                    {t('hero.fileLimit')}
                  </p>
                </>
              )}
              <div className="flex gap-2 mt-1">
                <span className="text-xs border border-border rounded px-2 py-0.5 text-muted">
                  .docx
                </span>
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
              <p className="text-xs text-muted">
                {t('hero.linksSupported')}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-muted">{t('hero.freeFirstPage')}</span>
          <button
            onClick={handleStartEditing}
            className="flex items-center gap-1.5 bg-forest text-white text-sm font-medium px-5 py-2.5 rounded-lg hover:bg-forest-mid transition-colors"
          >
            {t('hero.startEditing')}
            <span className="text-xs">→</span>
          </button>
        </div>
      </div>
    </section>
  )
}
