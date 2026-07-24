import { Check, Gift } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'
import { PRICING, formatBRL, type ServiceKey } from '../../lib/pricing'

function PriceCard({ service }: { service: ServiceKey }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { perPage, minimum } = PRICING[service]
  const features = t(`pricing.${service}.features`, { returnObjects: true }) as string[]

  const goToService = () =>
    navigate(ROUTES.getStarted, {
      state: {
        services: [service],
        guideline: 'abnt',
        file: null,
        pasteUrl: '',
        inputTab: 'upload',
        pageCount: null,
        title: '',
      },
    })

  return (
    <div className="rounded-2xl border border-border bg-white p-8 flex flex-col gap-6">
      <div>
        <p className="text-xs font-medium text-muted tracking-widest uppercase mb-4">
          {t(`services.${service}.label`)}
        </p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold text-ink">R${perPage}</span>
          <span className="text-sm text-muted">{t('pricing.perLauda')}</span>
        </div>
        <p className="text-xs text-muted mt-1.5">
          {t('pricing.minimum', { amount: formatBRL(minimum) })}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-sm text-ink">
            <Check size={14} className="text-forest-light shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
      </ul>

      <button
        onClick={goToService}
        className="mt-auto w-full py-3.5 rounded-xl bg-forest text-white text-sm font-medium hover:bg-forest-mid transition-colors"
      >
        {t(`services.${service}.cta`)}
      </button>
    </div>
  )
}

export default function Pricing() {
  const { t } = useTranslation()

  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-10">
        <p className="text-xs font-medium tracking-widest text-forest-light uppercase mb-4">
          {t('pricing.kicker')}
        </p>
        <h2 className="text-4xl lg:text-5xl font-semibold text-ink leading-tight tracking-tight mb-4">
          {t('pricing.title1')}
          <br />
          <em className="font-serif font-normal italic text-muted">{t('pricing.title2')}</em>
        </h2>
        <p className="text-sm text-muted max-w-md mx-auto">{t('pricing.subtitle')}</p>
        <p className="text-xs text-muted mt-2">{t('pricing.laudaNote')}</p>
      </div>

      <div className="flex items-start gap-3 rounded-xl bg-forest/[0.07] border border-forest/20 px-4 py-4 mb-6 max-w-2xl mx-auto">
        <Gift size={16} className="text-forest shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-forest leading-relaxed">{t('pricing.trialBanner')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PriceCard service="formatting" />
        <PriceCard service="proofreading" />
      </div>
    </section>
  )
}
