import { useTranslation } from 'react-i18next'

// TODO: Gate behind auth; redirect to sign-in if not authenticated
export default function GetStartedPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="bg-white rounded-2xl border border-border p-10 w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-ink mb-2">{t('getStarted.title')}</h1>
        <p className="text-sm text-muted">{t('getStarted.subtitle')}</p>
      </div>
    </div>
  )
}
