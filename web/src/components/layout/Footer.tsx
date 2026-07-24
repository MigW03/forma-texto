import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ROUTES } from '../../lib/routes'

export default function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border">
      <div className="max-w-6xl mx-auto px-6 py-12 flex flex-col md:flex-row md:items-start md:justify-between gap-8">
        <div className="max-w-xs">
          <Link to={ROUTES.home} className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 bg-ink rounded-md flex items-center justify-center">
              <span className="text-[#F0EEE8] font-semibold text-sm">F</span>
            </div>
            <span className="font-semibold text-ink text-[15px]">FormaTexto</span>
          </Link>
          <p className="text-sm text-muted leading-relaxed">{t('footer.tagline')}</p>
        </div>

        <div className="flex items-center gap-6">
          <Link to={ROUTES.terms} className="text-sm text-muted hover:text-ink transition-colors">
            {t('footer.terms')}
          </Link>
          <Link to={ROUTES.privacy} className="text-sm text-muted hover:text-ink transition-colors">
            {t('footer.privacy')}
          </Link>
        </div>
      </div>

      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <p className="text-xs text-muted">
            © {year} FormaTexto. {t('footer.rights')}
          </p>
        </div>
      </div>
    </footer>
  )
}
