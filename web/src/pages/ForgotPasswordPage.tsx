import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { ROUTES } from '../lib/routes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

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
        <Card>
          <CardHeader className="pt-8 pb-6">
            <CardTitle className="text-2xl">{t('auth.resetPassword.title')}</CardTitle>
            <CardDescription>{t('auth.resetPassword.subtitle')}</CardDescription>
          </CardHeader>

          <CardContent className="pt-0 pb-8">
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
                  <Label htmlFor="email">{t('auth.email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('auth.emailPlaceholder')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  variant="cta"
                  size="lg"
                  className="w-full mt-2"
                >
                  {loading ? '…' : t('auth.resetPassword.submit')}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted mt-6">
          <Link to={ROUTES.signIn} className="text-ink font-medium hover:underline">
            {t('auth.resetPassword.back')}
          </Link>
        </p>
      </div>
    </div>
  )
}
