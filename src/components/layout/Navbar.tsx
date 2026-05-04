import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'
import LanguageSwitcher from './LanguageSwitcher'

export default function Navbar() {
  const { pathname } = useLocation()
  const { t } = useTranslation()
  const isDashboard = pathname === ROUTES.dashboard

  return (
    <nav className="sticky top-0 z-50 bg-[#F0EEE8]/90 backdrop-blur-sm border-b border-[#DDDBD3]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          to={isDashboard ? ROUTES.dashboard : ROUTES.home}
          className="flex items-center gap-2"
        >
          <div className="w-7 h-7 bg-ink rounded-md flex items-center justify-center">
            <span className="text-[#F0EEE8] font-semibold text-sm">F</span>
          </div>
          <span className="font-semibold text-ink text-[15px]">FormaTexto</span>
        </Link>

        {isDashboard ? (
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              to={ROUTES.getStarted}
              className="flex items-center gap-1.5 bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-lg hover:bg-ink/90 transition-colors"
            >
              {t('nav.newService')}
              <span className="text-xs">→</span>
            </Link>
            <div className="w-8 h-8 rounded-full bg-forest flex items-center justify-center">
              <span className="text-white text-xs font-semibold">A</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link
              to={ROUTES.signIn}
              className="text-sm text-muted hover:text-ink transition-colors"
            >
              {t('nav.signIn')}
            </Link>
            <Link
              to={ROUTES.getStarted}
              className="flex items-center gap-1.5 bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-lg hover:bg-ink/90 transition-colors"
            >
              {t('nav.getStarted')}
              <span className="text-xs">→</span>
            </Link>
          </div>
        )}
      </div>
    </nav>
  )
}
