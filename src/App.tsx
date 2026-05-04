import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import LandingPage from './pages/LandingPage'
import AuthPage from './pages/AuthPage'
import GetStartedPage from './pages/GetStartedPage'
import CheckoutPage from './pages/CheckoutPage'
import DashboardPage from './pages/DashboardPage'
import { ROUTES } from './lib/routes'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-sand">
        <Navbar />
        <Routes>
          <Route path={ROUTES.home} element={<LandingPage />} />
          <Route path={ROUTES.signIn} element={<AuthPage mode="sign-in" />} />
          <Route path={ROUTES.signUp} element={<AuthPage mode="sign-up" />} />
          <Route path={ROUTES.getStarted} element={<GetStartedPage />} />
          <Route path={ROUTES.checkout} element={<CheckoutPage />} />
          <Route path={ROUTES.dashboard} element={<DashboardPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
