import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth-context'
import { ROUTES } from '../lib/routes'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="w-6 h-6 rounded-full border-2 border-forest border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to={ROUTES.signIn} replace />

  return <>{children}</>
}
