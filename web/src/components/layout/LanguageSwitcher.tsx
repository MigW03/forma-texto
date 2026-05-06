import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check } from 'lucide-react'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../lib/i18n'

const LABELS: Record<SupportedLanguage, { native: string; short: string }> = {
  en: { native: 'English', short: 'EN' },
  'pt-BR': { native: 'Português (Brasil)', short: 'PT-BR' },
  'pt-PT': { native: 'Português (Portugal)', short: 'PT-PT' },
}

export default function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = (
    SUPPORTED_LANGUAGES.includes(i18n.resolvedLanguage as SupportedLanguage)
      ? i18n.resolvedLanguage
      : 'en'
  ) as SupportedLanguage

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleSelect = (lng: SupportedLanguage) => {
    i18n.changeLanguage(lng)
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('languageSwitcher.label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors px-2 py-1.5 rounded-lg"
      >
        <Globe size={15} />
        <span className="text-xs font-medium">{LABELS[current].short}</span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-2 w-52 bg-white border border-border rounded-xl shadow-md py-1.5 z-50"
        >
          {SUPPORTED_LANGUAGES.map((lng) => {
            const isActive = lng === current
            return (
              <button
                key={lng}
                role="option"
                aria-selected={isActive}
                onClick={() => handleSelect(lng)}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                  isActive ? 'text-ink font-medium' : 'text-muted hover:text-ink hover:bg-[#F0EEE8]'
                }`}
              >
                {LABELS[lng].native}
                {isActive && <Check size={14} className="text-forest-light" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
