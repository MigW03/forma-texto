import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import ProtectedRoute from './components/ProtectedRoute'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import GetStartedPage from './pages/GetStartedPage'
import CheckoutPage from './pages/CheckoutPage'
import DashboardPage from './pages/DashboardPage'
import { AuthProvider } from './lib/auth-context'
import { ROUTES } from './lib/routes'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-sand">
          <Navbar />
          <Routes>
            <Route path={ROUTES.home} element={<LandingPage />} />
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
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  )
}
