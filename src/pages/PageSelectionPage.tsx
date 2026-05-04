import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Info } from 'lucide-react'
import { ROUTES } from '../lib/routes'

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

// Simple SVG document page thumbnail
function PageThumbnail({ pageNumber }: { pageNumber: number }) {
  const lineGroups = [
    [14, 18, 22, 26, 30, 34],
    [42, 46, 50, 54],
    [62, 66, 70, 74, 78],
    [86, 90, 94],
  ]
  return (
    <svg viewBox="0 0 100 130" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="130" fill="white" />
      {/* Header line */}
      <rect x="8" y="8" width={pageNumber === 1 ? 60 : 45} height="3" rx="1.5" fill="#E5E3DD" />
      {/* Text lines in groups */}
      {lineGroups.map((lines, gi) =>
        lines.map((y, li) => (
          <rect
            key={`${gi}-${li}`}
            x="8"
            y={y}
            width={li === lines.length - 1 ? 40 + (gi % 3) * 10 : 84}
            height="2"
            rx="1"
            fill="#DDDBD3"
          />
        ))
      )}
      {/* Table on page 1 */}
      {pageNumber === 1 && (
        <>
          <rect x="8" y="102" width="84" height="20" rx="1" fill="#F5F4F0" stroke="#E5E3DD" strokeWidth="0.5" />
          {[0, 1, 2].map(i => (
            <rect key={i} x={8 + i * 28} y="102" width="28" height="20" fill="none" stroke="#E5E3DD" strokeWidth="0.5" />
          ))}
          {[106, 112, 118].map(y => (
            <rect key={y} x="12" y={y} width="16" height="1.5" rx="0.75" fill="#DDDBD3" />
          ))}
        </>
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
  } | null

  const total = state?.pageCount ?? FALLBACK_PAGE_COUNT

  const [selected, setSelected] = useState<Set<number>>(() => {
    const all = new Set<number>()
    for (let i = 1; i <= total; i++) all.add(i)
    return all
  })
  const [rangeInput, setRangeInput] = useState(total > 1 ? `1-${total}` : `${total}`)
  const [rangeError, setRangeError] = useState(false)
  const [lastClicked, setLastClicked] = useState<number | null>(null)

  // Sync range input → selection
  const applyRange = useCallback((input: string) => {
    const parsed = parseRangeInput(input, total)
    if (parsed.size > 0) {
      setSelected(parsed)
      setRangeError(false)
    } else {
      setRangeError(true)
    }
  }, [total])

  // Sync selection → range input
  useEffect(() => {
    if (selected.size === 0) {
      setRangeInput('')
    } else {
      setRangeInput(selectionToRangeString(selected, total))
    }
  }, [selected, total])

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

  const canContinue = selected.size > 0

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
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors"
          >
            <ArrowLeft size={14} />
            {t('getStarted.backToDashboard')}
          </button>
        </div>

        <h1 className="text-xl font-semibold text-ink mb-1">{t('pageSelection.title')}</h1>
        <p className="text-sm text-muted mb-8">{t('pageSelection.subtitle')}</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
          {Array.from({ length: total }, (_, i) => i + 1).map(page => {
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
                  <PageThumbnail pageNumber={page} />

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
      </div>

      {/* Right panel */}
      <div className="w-72 shrink-0 border-l border-border bg-white flex flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col gap-6">
          {/* Info tip */}
          <div className="flex gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <Info size={14} className="shrink-0 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              {t('pageSelection.tip')}
            </p>
          </div>

          {/* Stats */}
          <div>
            <p className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
              {t('pageSelection.summary')}
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('pageSelection.totalPages')}</span>
                <span className="font-medium text-ink">{total}</span>
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
            <input
              type="text"
              value={rangeInput}
              onChange={(e) => setRangeInput(e.target.value)}
              onBlur={(e) => applyRange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyRange(rangeInput)}
              placeholder={t('pageSelection.rangePlaceholder')}
              className={`w-full text-sm border rounded-xl px-3 py-2.5 bg-[#F0EEE8] focus:outline-none focus:ring-2 transition-colors ${
                rangeError
                  ? 'border-red-300 focus:ring-red-200'
                  : 'border-border focus:ring-forest-mid/30'
              }`}
            />
            {rangeError && (
              <p className="text-xs text-red-500 mt-1.5">{t('pageSelection.rangeError')}</p>
            )}
            <p className="text-xs text-muted mt-1.5">{t('pageSelection.rangeHint')}</p>
          </div>

          {/* Select all / clear */}
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set(Array.from({ length: total }, (_, i) => i + 1)))}
              className="flex-1 text-xs font-medium text-muted border border-border rounded-lg py-2 hover:border-forest-mid/40 hover:text-ink transition-colors"
            >
              {t('pageSelection.selectAll')}
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="flex-1 text-xs font-medium text-muted border border-border rounded-lg py-2 hover:border-forest-mid/40 hover:text-ink transition-colors"
            >
              {t('pageSelection.clearAll')}
            </button>
          </div>
        </div>

        {/* Continue CTA */}
        <div className="px-6 py-5 border-t border-border">
          <button
            disabled={!canContinue}
            onClick={() => navigate(ROUTES.checkout, {
              state: { ...state, selectedPages: Array.from(selected).sort((a, b) => a - b) }
            })}
            className={`w-full flex items-center justify-center gap-2 text-sm font-semibold py-3 rounded-xl transition-all bg-forest text-white ${
              canContinue
                ? 'hover:bg-forest-mid cursor-pointer opacity-100'
                : 'opacity-40 cursor-not-allowed'
            }`}
          >
            {t('pageSelection.continue')}
            <span>→</span>
          </button>
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
