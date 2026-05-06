import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import GetStartedPage from './pages/GetStartedPage'
import CheckoutPage from './pages/CheckoutPage'
import DashboardPage from './pages/DashboardPage'
import TermsPage from './pages/TermsPage'
import PageSelectionPage from './pages/PageSelectionPage'
import TextExtractPage from './pages/TextExtractPage'
import { AuthProvider, useAuth } from './lib/auth-context'
import { ROUTES } from './lib/routes'
import './index.css'

function HomeRoute() {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? <Navigate to={ROUTES.dashboard} replace /> : <LandingPage />
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-sand">
          <Navbar />
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
            <Route
              path={ROUTES.pageSelection}
              element={<ProtectedRoute><PageSelectionPage /></ProtectedRoute>}
            />
            <Route
              path={ROUTES.textExtract}
              element={<ProtectedRoute><TextExtractPage /></ProtectedRoute>}
            />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
