import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Info, Check, ChevronDown } from 'lucide-react'
import { ROUTES } from '../lib/routes'
import { PRICING, calcPrice, formatBRL } from '../lib/pricing'
import { storeFile } from '../lib/file-store'
import { computeLaudas, type Lauda } from '../lib/laudas'
import { Button } from '@/components/ui/button'
import { useGuidelines } from '../lib/guidelines'

// Continuous-document preview styles: the in-flow "Lauda N" divider (badge on a
// dashed rule) and the "disabled" look applied to blocks of unselected laudas.
const LAUDA_PREVIEW_STYLES = `
  .docx-wrapper { background: transparent !important; padding: 0 !important; }
  .docx-wrapper > section.docx {
    box-shadow: 0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06) !important;
    border-radius: 8px !important;
    margin: 0 auto !important;
  }
  .lauda-divider {
    display: flex; align-items: center; gap: 14px; margin: 16px -9999px;
    pointer-events: none; user-select: none;
  }
  .lauda-divider-line { flex: 1 1 auto; height: 0; min-height: 0; border-top: 2px dashed rgba(26,26,24,0.30); align-self: center; }
  .lauda-divider-label {
    flex: 0 0 auto; display: inline-flex; align-items: center;
    background: rgba(26,60,46,0.08); border: 1px solid rgba(26,60,46,0.20); color: #1A3C2E;
    font-size: 12px; font-weight: 600; font-family: Inter, system-ui, sans-serif;
    letter-spacing: 0.04em; text-transform: uppercase; padding: 4px 11px;
    border-radius: 9999px; white-space: nowrap;
  }
  .lauda-disabled { opacity: 0.38; filter: grayscale(0.45); transition: opacity 0.15s, filter 0.15s; }
`

/** Build a "Lauda N" divider element (dashed rule on each side of a badge). */
function buildLaudaDivider(labelText: string): HTMLDivElement {
  const div = document.createElement('div')
  div.className = 'lauda-divider'
  const l1 = document.createElement('span'); l1.className = 'lauda-divider-line'
  const label = document.createElement('span'); label.className = 'lauda-divider-label'; label.textContent = labelText
  const l2 = document.createElement('span'); l2.className = 'lauda-divider-line'
  div.append(l1, label, l2)
  return div
}

/**
 * Renders the DOCX as one continuous flow (no page breaks). Laudas are computed
 * FROM the rendered block elements (their word counts), so dividers land exactly
 * on the rendered content and the dimming maps to the right blocks — regardless of
 * how the source XML structures things. The computed laudas are reported up via
 * `onLaudas` so the checklist and billing use the same boundaries the user sees.
 *
 * The docx is rendered once per file; selection changes only re-apply the
 * disabled styling (no re-render).
 */
function LaudaPreview({
  file,
  selected,
  dividerLabelFor,
  onLaudas,
}: {
  file: File
  selected: Set<number>
  dividerLabelFor: (n: number) => string
  onLaudas: (laudas: Lauda[]) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const blockElsRef = useRef<HTMLElement[]>([])
  const blockToLaudaRef = useRef<number[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let cancelled = false
    setLoading(true)
    import('docx-preview').then(({ renderAsync }) => {
      if (cancelled) return
      el.replaceChildren()
      return renderAsync(file, el, undefined, {
        breakPages: false,
        inWrapper: true,
        ignoreLastRenderedPageBreak: true,
      })
    }).then(() => {
      if (cancelled) return
      const style = document.createElement('style')
      style.textContent = LAUDA_PREVIEW_STYLES
      el.appendChild(style)

      // Rendered body blocks, in document order, across every section.
      // docx-preview sometimes wraps section content in a single intermediate div;
      // if the section's only non-style child is a DIV, descend into it so we get
      // individual paragraph/table elements rather than one big block.
      // docx-preview wraps body content in <article> inside each section.docx.
      // Use that as the block container; fall back to section if absent.
      const blocks = Array.from(el.querySelectorAll('section.docx')).flatMap(section => {
        const container = section.querySelector(':scope > article') ?? section
        return Array.from(container.children).filter(
          (b): b is HTMLElement => b instanceof HTMLElement && b.tagName !== 'STYLE'
        )
      })
      blockElsRef.current = blocks

      const laudas = computeLaudas(blocks.map(b => ({ text: b.textContent ?? '' })))

      // blockIndex → owning lauda number, for the disabled styling.
      const map: number[] = []
      for (const l of laudas) {
        for (let i = l.blockStart; i <= l.blockEnd; i++) map[i] = l.index
      }
      blockToLaudaRef.current = map

      // Divider after each lauda's last block (between laudas, not after the last).
      for (let k = 0; k < laudas.length - 1; k++) {
        const anchor = blocks[laudas[k].blockEnd]
        if (anchor) anchor.after(buildLaudaDivider(dividerLabelFor(laudas[k + 1].index)))
      }

      onLaudas(laudas)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // dividerLabelFor/onLaudas are stable enough; re-render only when the file changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // Re-apply the disabled styling whenever the selection changes (no docx re-render).
  useEffect(() => {
    const map = blockToLaudaRef.current
    blockElsRef.current.forEach((b, i) => {
      const lauda = map[i]
      b.classList.toggle('lauda-disabled', lauda != null && !selected.has(lauda))
    })
  }, [selected])

  return (
    <div className="relative min-h-[300px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
        </div>
      )}
      <div
        ref={containerRef}
        className={`transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
      />
    </div>
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
    title?: string
  } | null

  const file = state?.file ?? null

  const [laudas, setLaudas] = useState<Lauda[]>([])
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  // Laudas are computed by the preview from the rendered document and reported here,
  // so the checklist and the on-page dividers always agree. Select all by default.
  const handleLaudas = useCallback((ls: Lauda[]) => {
    setLaudas(ls)
    setSelected(new Set(ls.map(l => l.index)))
    setReady(true)
  }, [])

  const [activeServices, setActiveServices] = useState<Set<string>>(
    () => new Set(state?.services ?? [])
  )
  const [guideline, setGuideline] = useState<string>(state?.guideline ?? 'abnt')
  const guidelines = useGuidelines()
  const [hasReferences, setHasReferences] = useState(true)
  const [formatReferences, setFormatReferences] = useState<boolean | null>(null)

  // If the carried-over guideline isn't in the loaded catalog, snap to the first.
  useEffect(() => {
    if (guidelines.length && !guidelines.some(g => g.id === guideline)) {
      setGuideline(guidelines[0].id)
    }
  }, [guidelines, guideline])

  const toggleService = (svc: string) => {
    setActiveServices(prev => {
      const next = new Set(prev)
      next.has(svc) ? next.delete(svc) : next.add(svc)
      return next
    })
  }

  const toggleLauda = (n: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(n) ? next.delete(n) : next.add(n)
      return next
    })
  }

  const total = laudas.length
  const selectedCount = selected.size

  const referencesValid = !hasReferences || formatReferences !== null
  const canContinue = ready && selectedCount > 0 && activeServices.size > 0 && referencesValid

  const dividerLabelFor = useCallback((n: number) => t('laudas.dividerLabel', { n }), [t])

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
      {/* Left — lauda checklist */}
      <div className="w-[230px] shrink-0 border-r border-border bg-white flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-xs font-semibold text-ink uppercase tracking-widest">
            {t('laudas.listLabel')}
          </span>
        </div>
        <div className="px-2 py-2 flex gap-1">
          <button
            onClick={() => setSelected(new Set(laudas.map(l => l.index)))}
            className="flex-1 text-xs text-center text-muted hover:text-ink transition-colors rounded-lg py-1.5 hover:bg-[#F0EEE8]"
          >
            {t('pageSelection.selectAll')}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="flex-1 text-xs text-center text-muted hover:text-ink transition-colors rounded-lg py-1.5 hover:bg-[#F0EEE8]"
          >
            {t('pageSelection.clearAll')}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-2">
          {!ready ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
            </div>
          ) : (
            laudas.map(l => {
              const isSel = selected.has(l.index)
              return (
                <button
                  key={l.index}
                  onClick={() => toggleLauda(l.index)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${
                    isSel ? 'bg-forest/[0.06]' : 'hover:bg-[#F0EEE8]'
                  }`}
                >
                  <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    isSel ? 'bg-forest border-forest' : 'border-border'
                  }`}>
                    {isSel && <Check size={10} className="text-white" strokeWidth={3} />}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-sm leading-tight ${isSel ? 'text-ink font-medium' : 'text-muted'}`}>
                      {t('laudas.dividerLabel', { n: l.index })}
                    </p>
                    <p className="text-xs text-muted/70 leading-tight mt-0.5">
                      {t('laudas.wordCount', { n: l.wordCount })}
                    </p>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* Center — document preview */}
      <div className="flex-1 overflow-y-auto px-8 py-8 bg-[#E8E6DF]">
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
              }
            })}
          >
            <ArrowLeft size={14} />
            {t('pageSelection.backToProjects')}
          </Button>
        </div>

        <h1 className="text-xl font-semibold text-ink mb-1">{t('laudas.title')}</h1>
        <p className="text-sm text-muted mb-6">{t('laudas.subtitle')}</p>

        {file && (
          <LaudaPreview
            file={file}
            selected={selected}
            dividerLabelFor={dividerLabelFor}
            onLaudas={handleLaudas}
          />
        )}
      </div>

      {/* Right panel */}
      <div className="w-[380px] shrink-0 border-l border-border bg-white flex flex-col">
        <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col gap-6">
          {/* Info tip */}
          <div className="flex gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <Info size={14} className="shrink-0 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              {t('laudas.tip')}
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
                      {formatBRL(calcPrice(svc, selectedCount))}
                    </span>
                  </div>
                  <span className="text-xs text-muted/60 leading-none mt-1 self-end">
                    {formatBRL(PRICING[svc].perPage)}/{t('laudas.unit')} · mín. {formatBRL(PRICING[svc].minimum)}
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
                <span className="text-muted">{t('laudas.totalLaudas')}</span>
                <span className="font-medium text-ink">{total}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">{t('laudas.selectedLaudas')}</span>
                <span className={`font-medium ${selectedCount > 0 ? 'text-forest' : 'text-muted'}`}>
                  {selectedCount}
                </span>
              </div>
            </div>
          </div>

          {/* References */}
          <div className="bg-sand/50 rounded-xl px-4 py-4">
            <p className="text-xs font-medium text-muted uppercase tracking-widest mb-3">
              {t('project.references.title')}
            </p>
            <label
              className="flex items-start gap-2.5 cursor-pointer w-fit"
              onClick={() => {
                const next = !hasReferences
                setHasReferences(next)
                if (!next) setFormatReferences(null)
              }}
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
                <p className="text-xs text-muted/80 leading-relaxed">{t('laudas.referencesAuto')}</p>
                <div className="flex flex-col gap-1.5 mt-1">
                  <p className="text-xs font-medium text-ink leading-snug">
                    {t('project.references.formatChoice.label')}
                  </p>
                  <div className="flex flex-col gap-1">
                    {([true, false] as const).map(value => (
                      <button
                        key={String(value)}
                        type="button"
                        onClick={() => setFormatReferences(value)}
                        className="flex items-center gap-2 px-1 py-1.5 rounded-lg transition-colors hover:bg-border/30"
                      >
                        <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                          formatReferences === value ? 'border-forest' : 'border-border'
                        }`}>
                          {formatReferences === value && (
                            <div className="w-1.5 h-1.5 rounded-full bg-forest" />
                          )}
                        </div>
                        <span className="text-sm text-ink">
                          {t(value
                            ? 'project.references.formatChoice.yes'
                            : 'project.references.formatChoice.no'
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-muted/80 leading-relaxed">{t('project.references.disclaimer')}</p>
                <p className="text-xs text-muted/80 leading-relaxed">{t('project.references.accuracyDisclaimer')}</p>
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
              if (state.file) storeFile(state.file)
              navigate(ROUTES.checkout, {
                state: {
                  services: Array.from(activeServices),
                  pageCount: selectedCount,
                  laudaCount: total,
                  selectedLaudas: Array.from(selected).sort((a, b) => a - b),
                  guideline,
                  fileName: state.file?.name ?? null,
                  title: state.title ?? '',
                  formatReferences: hasReferences ? formatReferences ?? undefined : undefined,
                }
              })
            }}
          >
            {t('pageSelection.continue')}
            <span>→</span>
          </Button>
          {canContinue && (
            <p className="text-center text-xs text-muted mt-2">
              {selectedCount}{' '}
              {selectedCount === 1 ? t('laudas.lauda_one') : t('laudas.lauda_other')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
