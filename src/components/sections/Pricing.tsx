import { Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ROUTES } from '../../lib/routes'

const FREE_FEATURES = [
  'One free page, either service',
  'No credit card required',
  'Side-by-side preview',
]

const PAID_FEATURES = [
  'Up to 200 pages',
  'Both services included',
  'Three guideline switches',
  'Export .docx, .pdf, .tex',
]

export default function Pricing() {
  const navigate = useNavigate()

  return (
    <section className="max-w-6xl mx-auto px-6 py-24">
      <div className="text-center mb-12">
        <p className="text-xs font-medium tracking-widest text-forest-light uppercase mb-4">
          Pricing
        </p>
        <h2 className="text-4xl lg:text-5xl font-semibold text-ink leading-tight tracking-tight">
          Pay once,{' '}
          <em className="font-serif font-normal italic text-muted">per thesis.</em>
        </h2>
      </div>

      <div className="border border-border rounded-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-2 bg-white">
        {/* Free tier */}
        <div className="p-10 border-b lg:border-b-0 lg:border-r border-border flex flex-col">
          <p className="text-xs font-medium tracking-widest text-muted uppercase mb-6">
            Free trial
          </p>
          <div className="mb-2">
            <span className="text-5xl font-semibold text-ink">$0</span>
          </div>
          <p className="text-sm text-muted mb-8">First page on us.</p>

          <ul className="flex flex-col gap-3 mb-10">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-ink">
                <Check size={14} className="text-forest-light shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={() => navigate(ROUTES.getStarted)}
            className="mt-auto w-full py-3.5 rounded-xl border border-border text-sm font-medium text-ink hover:bg-[#F0EEE8] transition-colors"
          >
            Try one page
          </button>
        </div>

        {/* Paid tier */}
        <div className="p-10 flex flex-col">
          <p className="text-xs font-medium tracking-widest text-muted uppercase mb-6">
            Per thesis
          </p>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-5xl font-semibold text-ink">$29</span>
            <span className="text-sm text-muted">/ document</span>
          </div>
          <p className="text-sm text-muted mb-8">One payment, full thesis.</p>

          <ul className="flex flex-col gap-3 mb-10">
            {PAID_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-ink">
                <Check size={14} className="text-forest-light shrink-0" />
                {f}
              </li>
            ))}
          </ul>

          <button
            onClick={() => navigate(ROUTES.checkout)}
            className="mt-auto w-full py-3.5 rounded-xl bg-forest text-white text-sm font-medium hover:bg-forest-mid transition-colors"
          >
            Submit my thesis
          </button>
        </div>
      </div>
    </section>
  )
}
