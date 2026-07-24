import { Check, Clock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'
import { useGuidelines, localizedDescription } from '../../lib/guidelines'

/** Guidelines with no `specs/{id}.md` yet — shown as "coming soon", not selectable. */
const PLANNED_GUIDELINE_IDS = ['apa', 'mla', 'chicago'] as const

export default function Services() {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  // Sourced from the server's specs/ catalog — today that's ABNT only. Drops in
  // automatically the day a second spec file lands, no frontend change needed.
  const [activeGuideline] = useGuidelines()

  return (
    <section className="bg-white border-y border-border">
      <div className="max-w-6xl mx-auto px-6 py-24">
        <div className="mb-12">
          <p className="text-xs font-medium tracking-widest text-forest-light uppercase mb-4">
            {t('services.kicker')}
          </p>
          <h2 className="text-4xl lg:text-5xl font-semibold text-ink leading-tight tracking-tight">
            {t('services.title1')}
            <br />
            <em className="font-serif font-normal italic text-muted">{t('services.title2')}</em>
          </h2>
          <p className="text-sm text-muted max-w-lg mt-4">{t('services.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Proofreading card */}
          <div className="rounded-2xl border border-border p-8 flex flex-col gap-6">
            <div>
              <p className="text-xs font-medium text-muted tracking-widest uppercase mb-3">
                <span className="text-forest-light">01</span>&nbsp; {t('services.proofreading.label')}
              </p>
              <h3 className="text-2xl font-semibold text-ink leading-snug">
                {t('services.proofreading.title1')}{' '}
                <em className="font-serif font-normal italic text-forest-mid">
                  {t('services.proofreading.title2')}
                </em>
              </h3>
              <p className="mt-3 text-sm text-muted leading-relaxed">
                {t('services.proofreading.description')}
              </p>
            </div>

            {/* Mock diff preview — language-neutral sample text. Deliberately mechanical
                corrections only (spelling, agreement, a confused word) — matches what the
                pipeline actually does today (grammar/punctuation/spelling/tense), not
                word-choice or register rewriting. */}
            <div className="rounded-xl border border-border bg-[#FAFAF8] p-4 text-sm leading-relaxed">
              <p>
                The{' '}
                <span className="line-through text-red-400">resultss</span>{' '}
                <span className="text-forest-mid font-medium">results</span>{' '}
                show that the model{' '}
                <span className="line-through text-red-400">perform</span>{' '}
                <span className="text-forest-mid font-medium">performs</span>{' '}
                better{' '}
                <span className="line-through text-red-400">then</span>{' '}
                <span className="text-forest-mid font-medium">than</span>{' '}
                the baseline,{' '}
                <span className="line-through text-red-400">specialy</span>{' '}
                <span className="text-forest-mid font-medium">specially</span>{' '}
                on the long‑form benchmark.
              </p>
              <div className="flex gap-4 mt-4 text-xs text-muted font-mono">
                <span>
                  <span className="text-ink font-semibold">4</span> {t('services.proofreading.stats.corrections')}
                </span>
                <span>
                  <span className="text-ink font-semibold">0</span> {t('services.proofreading.stats.rewrites')}
                </span>
              </div>
            </div>

            <button
              onClick={() => navigate(ROUTES.getStarted)}
              className="mt-auto self-start flex items-center gap-1.5 bg-ink text-[#F0EEE8] text-sm font-medium px-5 py-3 rounded-xl hover:bg-ink/90 transition-colors"
            >
              {t('services.proofreading.cta')}
              <span className="text-xs">→</span>
            </button>
          </div>

          {/* Formatting card */}
          <div className="rounded-2xl border border-border p-8 flex flex-col gap-6">
            <div>
              <p className="text-xs font-medium text-muted tracking-widest uppercase mb-3">
                <span className="text-forest-light">02</span>&nbsp; {t('services.formatting.label')}
              </p>
              <h3 className="text-2xl font-semibold text-ink leading-snug">
                {t('services.formatting.title1')}{' '}
                <em className="font-serif font-normal italic text-forest-mid">
                  {t('services.formatting.title2')}
                </em>
              </h3>
              <p className="mt-3 text-sm text-muted leading-relaxed">
                {t('services.formatting.description')}
              </p>
            </div>

            {/* Active guideline — currently just ABNT, see the "coming soon" note below */}
            <div className="flex items-center justify-between rounded-xl px-4 py-3.5 bg-forest text-white">
              <div>
                <p className="text-sm font-medium">{activeGuideline.name}</p>
                <p className="text-xs mt-0.5 text-white/70">
                  {localizedDescription(activeGuideline.description, i18n.language)}
                </p>
              </div>
              <Check size={16} className="shrink-0" />
            </div>

            {/* Guideline roadmap — honest about what's implemented vs. planned. Dashed
                border echoes the Hero dropzone's own "not active yet" signifier. */}
            <div className="rounded-xl border border-dashed border-border px-4 py-3.5 flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted tracking-widest uppercase">
                <Clock size={12} aria-hidden="true" />
                {t('services.comingSoon.label')}
              </p>
              <div className="flex flex-wrap gap-2">
                {PLANNED_GUIDELINE_IDS.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg bg-sand text-muted border border-border"
                  >
                    {t(`services.guidelines.${id}.name`)}
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={() => navigate(ROUTES.getStarted)}
              className="mt-auto self-start flex items-center gap-1.5 bg-forest text-white text-sm font-medium px-5 py-3 rounded-xl hover:bg-forest-mid transition-colors"
            >
              {t('services.formatting.cta')}
              <span className="text-xs">→</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
