import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Navbar from './components/layout/Navbar'
import LandingPage from './pages/LandingPage'
import SignInPage from './pages/SignInPage'
import GetStartedPage from './pages/GetStartedPage'
import CheckoutPage from './pages/CheckoutPage'
import { ROUTES } from './lib/routes'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-sand">
        <Navbar />
        <Routes>
          <Route path={ROUTES.home} element={<LandingPage />} />
          <Route path={ROUTES.signIn} element={<SignInPage />} />
          <Route path={ROUTES.getStarted} element={<GetStartedPage />} />
          <Route path={ROUTES.checkout} element={<CheckoutPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
