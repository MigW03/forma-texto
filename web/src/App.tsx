import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import GetStartedPage from './pages/GetStartedPage'
import DashboardPage from './pages/DashboardPage'
import TermsPage from './pages/TermsPage'
import PrivacyPage from './pages/PrivacyPage'
import ProfilePage from './pages/ProfilePage'
import { AuthProvider, useAuth } from './lib/auth-context'
import { ROUTES } from './lib/routes'
import { HERO_HANDOFF_KEY } from './lib/file-store'
import './index.css'

// Heavy routes (pdfjs / docx-preview / pdf-lib) are code-split so the initial
// load stays light for visitors who only see the landing / auth pages.
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'))
const PageSelectionPage = lazy(() => import('./pages/PageSelectionPage'))
const ProjectDetailPage = lazy(() => import('./pages/ProjectDetailPage'))

function PageLoader() {
  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-forest border-t-transparent animate-spin" />
    </div>
  )
}

function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <LandingPage />
  // Google OAuth's redirectTo always lands back here — a pending Hero handoff means the
  // user was headed to /get-started, not the dashboard (mirrors AuthPage's own check for
  // the email/password path, which never routes through HomeRoute).
  const dest = sessionStorage.getItem(HERO_HANDOFF_KEY) ? ROUTES.getStarted : ROUTES.dashboard
  return <Navigate to={dest} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-sand">
          <Navbar />
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path={ROUTES.home} element={<HomeRoute />} />
            <Route path={ROUTES.signIn} element={<AuthPage mode="sign-in" />} />
            <Route path={ROUTES.signUp} element={<AuthPage mode="sign-up" />} />
            <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
            <Route
              path={ROUTES.getStarted}
              element={<ProtectedRoute><GetStartedPage /></ProtectedRoute>}
            />
            <Route
              path={ROUTES.checkout}
              element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>}
            />
            <Route
              path={ROUTES.dashboard}
              element={<ProtectedRoute><DashboardPage /></ProtectedRoute>}
            />
            <Route path={ROUTES.terms} element={<TermsPage />} />
            <Route path={ROUTES.privacy} element={<PrivacyPage />} />
            <Route
              path={ROUTES.pageSelection}
              element={<ProtectedRoute><PageSelectionPage /></ProtectedRoute>}
            />
            <Route
              path={ROUTES.project}
              element={<ProtectedRoute><ProjectDetailPage /></ProtectedRoute>}
            />
            <Route
              path={ROUTES.profile}
              element={<ProtectedRoute><ProfilePage /></ProtectedRoute>}
            />
          </Routes>
          </Suspense>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
