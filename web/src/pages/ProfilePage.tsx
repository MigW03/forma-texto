import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../lib/routes'

export default function ProfilePage() {
  const { t } = useTranslation()
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  const isGoogleUser = user?.app_metadata?.provider === 'google'

  const joinedDate = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null

  const userInitial = user?.user_metadata?.full_name?.[0]?.toUpperCase()
    ?? user?.email?.[0]?.toUpperCase()
    ?? '?'

  // Full name edit
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name ?? '')
  const [nameLoading, setNameLoading] = useState(false)
  const [nameSuccess, setNameSuccess] = useState(false)
  const [nameError, setNameError] = useState('')

  // Email edit
  const [email, setEmail] = useState(user?.email ?? '')
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [emailError, setEmailError] = useState('')

  // Password change modal (email users only)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState('')

  // Notification preferences
  const [notifPrefs, setNotifPrefs] = useState({ project_ready: true, file_expiry: true })
  const [notifSaved, setNotifSaved] = useState(false)

  // Load notification preferences from user_profiles
  useEffect(() => {
    if (!user) return
    supabase
      .from('user_profiles')
      .select('notification_preferences')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.notification_preferences) {
          setNotifPrefs(data.notification_preferences as { project_ready: boolean; file_expiry: boolean })
        }
      })
  }, [user])

  const handleNotifToggle = async (key: 'project_ready' | 'file_expiry') => {
    if (!user) return
    const updated = { ...notifPrefs, [key]: !notifPrefs[key] }
    setNotifPrefs(updated)
    setNotifSaved(false)
    await supabase
      .from('user_profiles')
      .update({ notification_preferences: updated })
      .eq('id', user.id)
    setNotifSaved(true)
    setTimeout(() => setNotifSaved(false), 2000)
  }

  // Danger zone accordion
  const [dangerOpen, setDangerOpen] = useState(false)

  // Delete account
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const handleSaveName = async () => {
    if (!fullName.trim()) return
    setNameLoading(true)
    setNameError('')
    setNameSuccess(false)
    const { error } = await supabase.auth.updateUser({ data: { full_name: fullName.trim() } })
    setNameLoading(false)
    if (error) setNameError(error.message)
    else setNameSuccess(true)
  }

  const handleSaveEmail = async () => {
    if (!email.trim() || email === user?.email) return
    setEmailLoading(true)
    setEmailError('')
    setEmailSent(false)
    const { error } = await supabase.auth.updateUser({ email: email.trim() })
    setEmailLoading(false)
    if (error) setEmailError(error.message)
    else setEmailSent(true)
  }

  const closePasswordModal = () => {
    setShowPasswordModal(false)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordSuccess(false)
  }

  const handleSavePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordError(t('profile.passwordTooShort'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatch'))
      return
    }
    if (!user?.email) return
    setPasswordLoading(true)
    setPasswordError('')

    // Re-authenticate to verify the current password
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    })
    if (signInError) {
      setPasswordError(t('profile.wrongCurrentPassword'))
      setPasswordLoading(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordLoading(false)
    if (error) {
      setPasswordError(error.message)
      return
    }

    // Best-effort notification email — requires email service on backend
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
    const session = (await supabase.auth.getSession()).data.session
    fetch(`${apiUrl}/api/auth/notify-password-change`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
    }).catch(() => undefined)

    setPasswordSuccess(true)
  }

  const handleDeleteAccount = async () => {
    setDeleteLoading(true)
    setDeleteError('')
    const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
    const session = (await supabase.auth.getSession()).data.session
    const res = await fetch(`${apiUrl}/api/auth/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setDeleteError((body as { error?: string }).error ?? t('profile.deleteError'))
      setDeleteLoading(false)
      return
    }
    await signOut()
    navigate(ROUTES.home, { replace: true })
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-center gap-5 mb-10">
        <div className="w-16 h-16 rounded-full bg-forest flex items-center justify-center flex-shrink-0">
          <span className="text-white text-2xl font-semibold">{userInitial}</span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {user?.user_metadata?.full_name || user?.email}
          </h1>
          <p className="text-sm text-muted mt-0.5">{user?.email}</p>
          {joinedDate && (
            <p className="text-xs text-muted mt-1">
              {t('profile.joined')} {joinedDate}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Personal info */}
        <div className="bg-white rounded-2xl border border-border px-6 py-5">
          <h2 className="text-sm font-semibold text-ink mb-4">{t('profile.personalInfo')}</h2>
          <div className="flex flex-col gap-4">
            {/* Full name */}
            <div>
              <label className="block text-xs text-muted mb-1.5">{t('profile.fullName')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={fullName}
                  onChange={e => { setFullName(e.target.value); setNameSuccess(false) }}
                  className="flex-1 text-sm text-ink bg-[#F0EEE8] border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest/20"
                  placeholder={t('profile.fullNamePlaceholder')}
                />
                <button
                  onClick={handleSaveName}
                  disabled={nameLoading || !fullName.trim()}
                  className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-xl hover:bg-ink/90 transition-colors disabled:opacity-50"
                >
                  {nameLoading ? t('profile.saving') : t('profile.save')}
                </button>
              </div>
              {nameSuccess && <p className="text-xs text-forest mt-1.5">{t('profile.saved')}</p>}
              {nameError && <p className="text-xs text-red-500 mt-1.5">{nameError}</p>}
            </div>

            {/* Email */}
            {!isGoogleUser && (
              <div>
                <label className="block text-xs text-muted mb-1.5">{t('profile.email')}</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setEmailSent(false) }}
                    className="flex-1 text-sm text-ink bg-[#F0EEE8] border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest/20"
                  />
                  <button
                    onClick={handleSaveEmail}
                    disabled={emailLoading || email === user?.email || !email.trim()}
                    className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-xl hover:bg-ink/90 transition-colors disabled:opacity-50"
                  >
                    {emailLoading ? t('profile.saving') : t('profile.confirm')}
                  </button>
                </div>
                {emailSent && (
                  <p className="text-xs text-muted mt-1.5">{t('profile.emailConfirmationSent')}</p>
                )}
                {emailError && <p className="text-xs text-red-500 mt-1.5">{emailError}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Password (email users only) */}
        {!isGoogleUser && (
          <div className="bg-white rounded-2xl border border-border px-6 py-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">{t('profile.changePassword')}</h2>
                <p className="text-xs text-muted mt-0.5">{t('profile.changePasswordHint')}</p>
              </div>
              <button
                onClick={() => setShowPasswordModal(true)}
                className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-xl hover:bg-ink/90 transition-colors"
              >
                {t('profile.changePasswordBtn')}
              </button>
            </div>
          </div>
        )}

        {/* Notification preferences */}
        <div className="bg-white rounded-2xl border border-border px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-ink">{t('profile.notifications.title')}</h2>
            {notifSaved && <span className="text-xs text-forest">{t('profile.notifications.saved')}</span>}
          </div>
          <div className="flex flex-col gap-4">
            {/* Project ready */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-ink">{t('profile.notifications.projectReady')}</p>
                <p className="text-xs text-muted mt-0.5">{t('profile.notifications.projectReadyHint')}</p>
              </div>
              <button
                role="switch"
                aria-checked={notifPrefs.project_ready}
                onClick={() => handleNotifToggle('project_ready')}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notifPrefs.project_ready ? 'bg-forest' : 'bg-border'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${notifPrefs.project_ready ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            {/* File expiry */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm text-ink">{t('profile.notifications.fileExpiry')}</p>
                <p className="text-xs text-muted mt-0.5">{t('profile.notifications.fileExpiryHint')}</p>
              </div>
              <button
                role="switch"
                aria-checked={notifPrefs.file_expiry}
                onClick={() => handleNotifToggle('file_expiry')}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${notifPrefs.file_expiry ? 'bg-forest' : 'bg-border'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${notifPrefs.file_expiry ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
        </div>

        {/* Danger zone */}
        <div className="bg-white rounded-2xl border border-red-100 px-6 py-5">
          <button
            onClick={() => setDangerOpen(o => !o)}
            className="flex items-center justify-between w-full text-left"
          >
            <h2 className="text-sm font-semibold text-red-600">{t('profile.dangerZone')}</h2>
            <svg
              width="16" height="16" viewBox="0 0 16 16" fill="none"
              className={`text-red-400 transition-transform duration-200 ${dangerOpen ? 'rotate-180' : ''}`}
            >
              <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {dangerOpen && (
            <div className="mt-4">
              <p className="text-sm font-medium text-red-600 mb-1">{t('profile.dangerZoneSubtitle')}</p>
              <p className="text-xs text-muted mb-4">{t('profile.deleteAccountNotice')}</p>
              <button
                onClick={() => setShowDeleteModal(true)}
                className="text-sm font-medium text-red-600 px-4 py-2 rounded-xl border border-red-200 hover:bg-red-50 transition-colors"
              >
                {t('profile.deleteAccount')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Password change modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-border px-6 py-6 max-w-sm w-full mx-4 shadow-sm">
            {passwordSuccess ? (
              <>
                <h3 className="text-base font-semibold text-ink mb-2">{t('profile.passwordChanged')}</h3>
                <p className="text-sm text-muted mb-6">{t('profile.passwordChangedNotice')}</p>
                <div className="flex justify-end">
                  <button
                    onClick={closePasswordModal}
                    className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-xl hover:bg-ink/90 transition-colors"
                  >
                    {t('profile.done')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-ink mb-1">{t('profile.passwordModalTitle')}</h3>
                <p className="text-sm text-muted mb-5">{t('profile.passwordModalSubtitle')}</p>
                <div className="flex flex-col gap-3 mb-5">
                  <div>
                    <label className="block text-xs text-muted mb-1.5">{t('profile.currentPassword')}</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={e => { setCurrentPassword(e.target.value); setPasswordError('') }}
                      placeholder="••••••••"
                      className="w-full text-sm text-ink bg-[#F0EEE8] border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">{t('profile.newPassword')}</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => { setNewPassword(e.target.value); setPasswordError('') }}
                      placeholder={t('profile.newPasswordPlaceholder')}
                      className="w-full text-sm text-ink bg-[#F0EEE8] border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest/20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted mb-1.5">{t('profile.confirmPassword')}</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => { setConfirmPassword(e.target.value); setPasswordError('') }}
                      placeholder={t('profile.newPasswordPlaceholder')}
                      className="w-full text-sm text-ink bg-[#F0EEE8] border border-border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-forest/20"
                    />
                  </div>
                  {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={closePasswordModal}
                    disabled={passwordLoading}
                    className="text-sm text-muted hover:text-ink transition-colors px-4 py-2 rounded-xl"
                  >
                    {t('profile.cancel')}
                  </button>
                  <button
                    onClick={handleSavePassword}
                    disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
                    className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-xl hover:bg-ink/90 transition-colors disabled:opacity-50"
                  >
                    {passwordLoading ? t('profile.saving') : t('profile.save')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl border border-border px-6 py-6 max-w-sm w-full mx-4 shadow-sm">
            <h3 className="text-base font-semibold text-ink mb-2">{t('profile.deleteModalTitle')}</h3>
            <p className="text-sm text-muted mb-6">{t('profile.deleteModalBody')}</p>
            {deleteError && <p className="text-xs text-red-500 mb-4">{deleteError}</p>}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteError('') }}
                disabled={deleteLoading}
                className="text-sm text-muted hover:text-ink transition-colors px-4 py-2 rounded-xl"
              >
                {t('profile.cancel')}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading}
                className="bg-red-600 text-white text-sm font-medium px-4 py-2 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {deleteLoading ? t('profile.deleting') : t('profile.deleteAccount')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
