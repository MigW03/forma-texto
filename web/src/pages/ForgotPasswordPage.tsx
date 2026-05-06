import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { ROUTES } from '../lib/routes'

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}${ROUTES.signIn}`,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-ink mb-1">
              {t('auth.resetPassword.title')}
            </h1>
            <p className="text-sm text-muted">{t('auth.resetPassword.subtitle')}</p>
          </div>

          {sent ? (
            <p className="text-sm text-forest bg-forest/10 border border-forest/20 rounded-xl px-4 py-3">
              {t('auth.resetSent')}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  {t('auth.email')}
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full text-sm border border-border rounded-xl px-4 py-3 bg-[#F0EEE8] placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-mid/30"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 bg-forest text-white text-sm font-medium py-3 rounded-xl hover:bg-forest-mid transition-colors disabled:opacity-60"
              >
                {loading ? '…' : t('auth.resetPassword.submit')}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-muted mt-6">
          <Link to={ROUTES.signIn} className="text-ink font-medium hover:underline">
            {t('auth.resetPassword.back')}
          </Link>
        </p>
      </div>
    </div>
  )
}
