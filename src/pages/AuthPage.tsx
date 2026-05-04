import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'
import { ROUTES } from '../lib/routes'

interface AuthPageProps {
  mode: 'sign-in' | 'sign-up'
}

export default function AuthPage({ mode }: AuthPageProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkEmail, setCheckEmail] = useState(false)
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuth()

  const isSignUp = mode === 'sign-up'
  const ns = isSignUp ? 'auth.signUp' : 'auth.signIn'

  useEffect(() => {
    if (user) navigate(ROUTES.dashboard, { replace: true })
  }, [user, navigate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })

      setLoading(false)

      if (error) {
        setError(error.message)
      } else if (data.session) {
        navigate(ROUTES.dashboard, { replace: true })
      } else {
        setCheckEmail(true)
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })

      setLoading(false)

      if (error) {
        setError(error.message)
      } else {
        navigate(ROUTES.dashboard, { replace: true })
      }
    }
  }

  const handleGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${ROUTES.dashboard}` },
    })
  }

  if (checkEmail) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl border border-border shadow-sm p-8 text-center">
            <h2 className="text-xl font-semibold text-ink mb-2">{t('auth.checkEmailTitle')}</h2>
            <p className="text-sm text-muted">{t('auth.checkEmail')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-ink mb-1">
              {t(`${ns}.title`)}
            </h1>
            <p className="text-sm text-muted">
              {t(`${ns}.subtitle`)}
            </p>
          </div>

          {/* Google */}
          <button
            onClick={handleGoogle}
            type="button"
            className="w-full flex items-center justify-center gap-3 border border-border rounded-xl py-3 text-sm font-medium text-ink hover:bg-sand transition-colors mb-6"
          >
            <GoogleIcon />
            {t('auth.google')}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted">{t('auth.or')}</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                {error}
              </p>
            )}

            {isSignUp && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  {t('auth.fullName')}
                </label>
                <input
                  type="text"
                  autoComplete="name"
                  placeholder={t('auth.fullNamePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full text-sm border border-border rounded-xl px-4 py-3 bg-[#F0EEE8] placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-mid/30"
                />
              </div>
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

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted uppercase tracking-wider">
                  {t('auth.password')}
                </label>
                {!isSignUp && (
                  <Link
                    to={ROUTES.forgotPassword}
                    className="text-xs text-muted hover:text-ink transition-colors"
                  >
                    {t('auth.forgotPassword')}
                  </Link>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  placeholder={
                    isSignUp
                      ? t('auth.passwordPlaceholderSignUp')
                      : t('auth.passwordPlaceholderSignIn')
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full text-sm border border-border rounded-xl px-4 py-3 pr-11 bg-[#F0EEE8] placeholder:text-muted/60 focus:outline-none focus:ring-2 focus:ring-forest-mid/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink transition-colors"
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 bg-forest text-white text-sm font-medium py-3 rounded-xl hover:bg-forest-mid transition-colors disabled:opacity-60"
            >
              {loading ? '…' : t(`${ns}.submit`)}
            </button>
          </form>
        </div>

        {/* Switch mode */}
        <p className="text-center text-sm text-muted mt-6">
          {isSignUp ? t('auth.alreadyHave') : t('auth.dontHave')}{' '}
          <Link
            to={isSignUp ? ROUTES.signIn : ROUTES.signUp}
            className="text-ink font-medium hover:underline"
          >
            {isSignUp ? t('auth.switchToSignIn') : t('auth.switchToSignUp')}
          </Link>
        </p>
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  )
}
