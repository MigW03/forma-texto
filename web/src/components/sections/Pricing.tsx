import { Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'

export default function Pricing() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  const freeFeatures = t('pricing.free.features', { returnObjects: true }) as string[]
  const paidFeatures = t('pricing.paid.features', { returnObjects: true }) as string[]

  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-12">
        <p className="text-xs font-medium tracking-widest text-forest-light uppercase mb-4">
          {t('pricing.kicker')}
        </p>
        <h2 className="text-4xl lg:text-5xl font-semibold text-ink leading-tight tracking-tight">
          {t('pricing.title1')}{' '}
          <em className="font-serif font-normal italic text-muted">{t('pricing.title2')}</em>
        </h2>
      </div>

      <div className="border border-border rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 bg-white">
        {/* Free tier */}
        <div className="p-10 border-b lg:border-b-0 lg:border-r border-border flex flex-col">
          <p className="text-xs font-medium tracking-widest text-muted uppercase mb-6">
            {t('pricing.free.label')}
          </p>
          <div className="mb-2">
            <span className="text-5xl font-semibold text-ink">$0</span>
          </div>
          <p className="text-sm text-muted mb-8">{t('pricing.free.subtitle')}</p>

          <ul className="flex flex-col gap-3 mb-10">
            {freeFeatures.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-ink">
                <Check size={14} className="text-forest-light shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={() => navigate(ROUTES.getStarted)}
            className="mt-auto w-full py-3.5 rounded-xl border border-border text-sm font-medium text-ink hover:bg-[#F0EEE8] transition-colors"
          >
            {t('pricing.free.cta')}
          </button>
        </div>

        {/* Paid tier */}
        <div className="p-10 flex flex-col">
          <p className="text-xs font-medium tracking-widest text-muted uppercase mb-6">
            {t('pricing.paid.label')}
          </p>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-5xl font-semibold text-ink">$29</span>
            <span className="text-sm text-muted">{t('pricing.paid.perDocument')}</span>
          </div>
          <p className="text-sm text-muted mb-8">{t('pricing.paid.subtitle')}</p>

          <ul className="flex flex-col gap-3 mb-10">
            {paidFeatures.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-ink">
                <Check size={14} className="text-forest-light shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={() => navigate(ROUTES.checkout)}
            className="mt-auto w-full py-3.5 rounded-xl bg-forest text-white text-sm font-medium hover:bg-forest-mid transition-colors"
          >
            {t('pricing.paid.cta')}
          </button>
        </div>
      </div>
    </section>
  )
}
