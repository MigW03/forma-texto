import { useTranslation } from 'react-i18next'

// TODO: Replace with real payment UI (e.g. Stripe Checkout)
export default function CheckoutPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-border p-10 w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">{t('checkout.title')}</h1>
        <p className="text-sm text-muted">{t('checkout.subtitle')}</p>
      </div>
    </div>
  )
}
