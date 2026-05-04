import { useState } from 'react'
import { Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'

const GUIDELINE_IDS = ['abnt', 'apa', 'mla', 'chicago'] as const

export default function Services() {
  const [selectedGuideline, setSelectedGuideline] = useState<string>('abnt')
  const navigate = useNavigate()
  const { t } = useTranslation()

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

            {/* Mock diff preview — language-neutral sample text */}
            <div className="rounded-xl border border-border bg-[#FAFAF8] p-4 text-sm leading-relaxed">
              <p>
                The results{' '}
                <span className="line-through text-red-400">show that</span>{' '}
                <span className="text-forest-mid font-medium">demonstrate that</span>{' '}
                the model{' '}
                <span className="line-through text-red-400">is performing</span>{' '}
                <span className="text-forest-mid font-medium">performs</span>{' '}
                better{' '}
                <span className="line-through text-red-400">then</span>{' '}
                <span className="text-forest-mid font-medium">than</span>{' '}
                the baseline across all three datasets,{' '}
                <span className="line-through text-red-400">specially</span>{' '}
                <span className="text-forest-mid font-medium">especially</span>{' '}
                on the long‑form benchmark.
              </p>
              <div className="flex gap-4 mt-4 text-xs text-muted font-mono">
                <span>
                  <span className="text-ink font-semibold">4</span> {t('services.proofreading.stats.corrections')}
                </span>
                <span>
                  <span className="text-ink font-semibold">1</span> {t('services.proofreading.stats.tone')}
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

            {/* Guideline selector */}
            <div className="flex flex-col gap-2">
              {GUIDELINE_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setSelectedGuideline(id)}
                  className={`flex items-center justify-between rounded-xl px-4 py-3.5 text-left transition-colors ${
                    selectedGuideline === id
                      ? 'bg-forest text-white'
                      : 'border border-border hover:border-forest-mid/40 text-ink'
                  }`}
                >
                  <div>
                    <p className="text-sm font-medium">{t(`services.guidelines.${id}.name`)}</p>
                    <p
                      className={`text-xs mt-0.5 ${
                        selectedGuideline === id ? 'text-white/70' : 'text-muted'
                      }`}
                    >
                      {t(`services.guidelines.${id}.description`)}
                    </p>
                  </div>
                  {selectedGuideline === id && (
                    <Check size={16} className="shrink-0" />
                  )}
                </button>
              ))}
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
