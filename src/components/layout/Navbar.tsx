import { Link } from 'react-router-dom'
import { ROUTES } from '../../lib/routes'

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-50 bg-[#F0EEE8]/90 backdrop-blur-sm border-b border-[#DDDBD3]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to={ROUTES.home} className="flex items-center gap-2">
          <div className="w-7 h-7 bg-ink rounded-md flex items-center justify-center">
            <span className="text-[#F0EEE8] font-semibold text-sm">F</span>
          </div>
          <span className="font-semibold text-ink text-[15px]">FormaTexto</span>
        </Link>

        <div className="flex items-center gap-4">
          <Link
            to={ROUTES.signIn}
            className="text-sm text-muted hover:text-ink transition-colors"
          >
            Sign in
          </Link>
          <Link
            to={ROUTES.getStarted}
            className="flex items-center gap-1.5 bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2 rounded-lg hover:bg-ink/90 transition-colors"
          >
            Get started
            <span className="text-xs">→</span>
          </Link>
        </div>
      </div>
    </nav>
  )
}
