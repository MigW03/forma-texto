import { useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { Check, ArrowLeft, Gift, Clock, Loader2 } from 'lucide-react'
import { calcPrice, trialDiscountBRL, formatBRL, type ServiceKey } from '../lib/pricing'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { getStoredFile } from '../lib/file-store'
import { slicePdf } from '../lib/pdf-slice'
import { sliceDocx } from '../lib/docx-slice'
import { ROUTES } from '../lib/routes'

const SERVICE_LABELS: Record<ServiceKey, string> = {
  formatting: 'Formatação',
  proofreading: 'Revisão',
}

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string)
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
const SESSION_KEY = 'forma-texto-checkout'

// ── Success screen ─────────────────────────────────────────────────────────────

function SuccessScreen({ free = false }: { free?: boolean }) {
  const navigate = useNavigate()
  useEffect(() => {
    const t = setTimeout(() => navigate(ROUTES.dashboard), 3000)
    return () => clearTimeout(t)
  }, [navigate])

  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="w-14 h-14 rounded-full bg-forest flex items-center justify-center">
        <Check size={26} className="text-white" />
      </div>
      <p className="text-base font-semibold text-ink">
        {free ? 'Período gratuito ativado!' : 'Pagamento confirmado!'}
      </p>
      <p className="text-sm text-muted">Redirecionando para o painel…</p>
    </div>
  )
}

// ── Saving screen (upload in progress) ────────────────────────────────────────

function SavingScreen() {
  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <Loader2 size={32} className="text-forest animate-spin" />
      <p className="text-base font-semibold text-ink">Salvando seu documento…</p>
      <p className="text-sm text-muted">Só um momento.</p>
    </div>
  )
}

// ── Payment form (needs Elements context) ─────────────────────────────────────

function PaymentForm({
  totalBRL,
  onSuccess,
}: {
  totalBRL: number
  onSuccess: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    setError(null)

    const { error: submitError } = await elements.submit()
    if (submitError) {
      setError(submitError.message ?? 'Erro no pagamento')
      setSubmitting(false)
      return
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${ROUTES.checkout}` },
      redirect: 'if_required',
    })

    if (confirmError) {
      setError(confirmError.message ?? 'Erro no pagamento')
      setSubmitting(false)
      return
    }

    onSuccess()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <PaymentElement options={{ layout: 'tabs', paymentMethodOrder: ['card'] }} />

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !stripe}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-all bg-forest text-white ${
          submitting || !stripe ? 'opacity-40 cursor-not-allowed' : 'hover:bg-forest-mid cursor-pointer'
        }`}
      >
        {submitting ? 'Processando…' : `Pagar ${formatBRL(totalBRL)}`}
      </button>
    </form>
  )
}

// ── Free trial CTA ─────────────────────────────────────────────────────────────

function FreeOrderButton({
  services,
  pageCount,
  userId,
  onSuccess,
}: {
  services: ServiceKey[]
  pageCount: number
  userId: string
  onSuccess: (orderId: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFree() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/checkout/complete-free-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services, pageCount, userId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro')
      onSuccess(data.orderId)
    } catch (err) {
      setError((err as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-forest/[0.07] border border-forest/20 px-4 py-4">
        <Gift size={16} className="text-forest shrink-0 mt-0.5" />
        <p className="text-sm text-forest leading-relaxed">
          Seu documento tem apenas 1 página. Com o período gratuito, você não paga nada agora.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <button
        onClick={handleFree}
        disabled={submitting}
        className={`w-full py-3 rounded-xl text-sm font-semibold transition-all bg-forest text-white ${
          submitting ? 'opacity-40 cursor-not-allowed' : 'hover:bg-forest-mid cursor-pointer'
        }`}
      >
        {submitting ? 'Processando…' : 'Continuar grátis →'}
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface CheckoutState {
  services: ServiceKey[]
  pageCount: number
  selectedPages?: number[]
  guideline?: string
  fileName?: string | null
  title?: string
  referencePages?: number[]
  formatReferences?: boolean
}

type IntentResponse =
  | { isFree: true; isTrial: true }
  | { clientSecret: string; isTrial: boolean; discountBRL: number }
  | { error: string }

type PageStatus = 'idle' | 'saving' | 'done'

export default function CheckoutPage() {
  const location = useLocation()
  const { user } = useAuth()

  const searchParams = new URLSearchParams(location.search)
  const redirectStatus = searchParams.get('redirect_status')
  const returnedClientSecret = searchParams.get('payment_intent_client_secret')

  const savedSession = (() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as CheckoutState | null }
    catch { return null }
  })()

  const state: CheckoutState | null = (location.state as CheckoutState | null) ?? savedSession

  const [intentData, setIntentData] = useState<IntentResponse | null>(
    returnedClientSecret ? { clientSecret: returnedClientSecret, isTrial: false, discountBRL: 0 } : null
  )
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [pageStatus, setPageStatus] = useState<PageStatus>('idle')
  const [isFreeOrder, setIsFreeOrder] = useState(false)

  const services = state?.services ?? []
  const pageCount = state?.pageCount ?? 0

  const fullTotal = services.reduce((sum, s) => sum + calcPrice(s, pageCount), 0)
  const isTrial = intentData && 'isTrial' in intentData ? intentData.isTrial : false
  const discountBRL = intentData && 'discountBRL' in intentData ? intentData.discountBRL : 0
  const finalTotal = Math.max(fullTotal - discountBRL, 0)

  useEffect(() => {
    if (returnedClientSecret) return
    if (!user || services.length === 0 || pageCount < 1) return

    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      services,
      pageCount,
      selectedPages: state?.selectedPages ?? [],
      guideline: state?.guideline,
      fileName: state?.fileName,
    }))

    fetch(`${API_URL}/api/checkout/create-payment-intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ services, pageCount, userId: user.id }),
    })
      .then(r => r.json())
      .then((data: IntentResponse) => {
        if ('error' in data) setFetchError(data.error)
        else setIntentData(data)
      })
      .catch(() => setFetchError('Não foi possível conectar ao servidor'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Post-payment: upload file + create project ──────────────────────────────

  async function handleSuccess(orderId?: string) {
    if (!user) return
    setPageStatus('saving')

    try {
      const rawFile = getStoredFile()
      const selectedPages = state?.selectedPages ?? []
      const projectId = crypto.randomUUID()
      let storagePath: string | null = null
      const fileName = rawFile?.name ?? state?.fileName ?? null

      // 1. Prepare the file to upload — slice to ALL selected pages (references included).
      //    References are no longer split into a separate file; the server's Step B
      //    detects the references section by heading text inside the single document.
      const referencePages = state?.referencePages ?? []
      const fileName2 = rawFile?.name.toLowerCase() ?? ''
      const isDocxFile = fileName2.endsWith('.docx')
      const isPdfFile = fileName2.endsWith('.pdf')
      let fileToUpload: File | null = rawFile
      if (rawFile && selectedPages.length > 0) {
        try {
          if (isPdfFile) fileToUpload = await slicePdf(rawFile, selectedPages)
          else if (isDocxFile) fileToUpload = await sliceDocx(rawFile, selectedPages)
        } catch (err) {
          console.error('File slicing failed, uploading full file:', err)
        }
      }

      // 2. Upload to Supabase Storage (DOCX stored as .zip — same bytes, renamed)
      if (fileToUpload) {
        const isDocx = fileToUpload.name.toLowerCase().endsWith('.docx')
        const uploadFile = isDocx
          ? new File([fileToUpload], fileToUpload.name.replace(/\.docx$/i, '.zip'), { type: 'application/zip' })
          : fileToUpload
        const safeName = uploadFile.name
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .replace(/\s+/g, '_')
        const path = `${user.id}/${projectId}/original/${safeName}`
        const { error: uploadError } = await supabase.storage
          .from('projects')
          .upload(path, uploadFile, { upsert: false })
        if (!uploadError) {
          storagePath = path
        } else {
          console.error('File upload failed:', uploadError)
        }
      }

      // (References are no longer sliced/uploaded separately — they stay in the single
      //  file above and are handled by the server's Step B.)

      // 4. Create project record
      const deleteAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      const { error: projectError } = await supabase.from('projects').insert({
        id: projectId,
        user_id: user.id,
        order_id: orderId ?? null,
        services,
        guideline: state?.guideline ?? null,
        page_count: pageCount,
        selected_pages: selectedPages.length > 0 ? selectedPages : null,
        status: 'pending',
        original_file_name: fileName,
        original_file_path: storagePath,
        references_pages: referencePages.length > 0 ? referencePages : null,
        delete_files_at: deleteAt,
        title: state?.title?.trim() || fileName || null,
      })

      if (projectError) {
        console.error('Project creation failed:', projectError)
      } else {
        // 5. Trigger processing (fire-and-forget). Formatting runs on our server's
        //    pipeline; proofreading-only projects still go to the n8n webhook.
        if (services.includes('formatting')) {
          const token = (await supabase.auth.getSession()).data.session?.access_token
          fetch(`${API_URL}/api/processing/start`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ projectId }),
          }).catch(() => {})
        } else {
          fetch(`${API_URL}/api/checkout/notify`, { method: 'POST' }).catch(() => {})
        }
      }
    } catch (err) {
      console.error('Post-payment error:', err)
    }

    sessionStorage.removeItem(SESSION_KEY)
    setPageStatus('done')
  }

  // ── Guard: no state ─────────────────────────────────────────────────────────

  if (!state || services.length === 0) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted mb-4">Nenhum pedido encontrado.</p>
          <Link to={ROUTES.getStarted} className="text-sm text-ink underline">Voltar ao início</Link>
        </div>
      </div>
    )
  }

  // ── Redirect return from boleto/PIX ─────────────────────────────────────────

  if (redirectStatus) {
    return (
      <div className="max-w-lg mx-auto px-6 py-12 flex flex-col items-center gap-4 pt-32">
        {redirectStatus === 'succeeded' ? (
          <SuccessScreen />
        ) : (
          <>
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
              {redirectStatus === 'failed' ? 'Pagamento recusado. Tente novamente.' : 'Pagamento pendente. Verifique seu e-mail.'}
            </p>
            <Link to={ROUTES.checkout} state={state} className="text-sm text-ink underline">Tentar novamente</Link>
          </>
        )}
      </div>
    )
  }

  // ── Saving / done screens ───────────────────────────────────────────────────

  if (pageStatus === 'saving') {
    return (
      <div className="max-w-lg mx-auto px-6 py-12 pt-32">
        <SavingScreen />
      </div>
    )
  }

  if (pageStatus === 'done') {
    return (
      <div className="max-w-lg mx-auto px-6 py-12 pt-32">
        <SuccessScreen free={isFreeOrder} />
      </div>
    )
  }

  // ── Main checkout UI ────────────────────────────────────────────────────────

  const appearance = {
    theme: 'stripe' as const,
    variables: {
      colorPrimary: '#2D5A4B',
      colorBackground: '#ffffff',
      colorText: '#1A1A18',
      colorDanger: '#dc2626',
      fontFamily: 'Inter, system-ui, sans-serif',
      borderRadius: '10px',
    },
  }

  const isFree = intentData && 'isFree' in intentData && intentData.isFree
  const clientSecret = intentData && 'clientSecret' in intentData ? intentData.clientSecret : null

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <Link
        to={ROUTES.getStarted}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-8"
      >
        <ArrowLeft size={14} />
        Voltar
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-semibold text-ink">Finalizar pedido</h1>
        {isTrial && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-forest bg-forest/10 border border-forest/20 rounded-full px-2.5 py-1">
            <Gift size={11} />
            Período gratuito
          </span>
        )}
      </div>
      <p className="text-sm text-muted mb-8">Revise e confirme o pagamento</p>

      {/* Order summary */}
      <div className="bg-white rounded-2xl border border-border p-6 mb-6">
        <p className="text-xs font-medium text-muted uppercase tracking-widest mb-4">Resumo</p>
        <div className="flex flex-col gap-3">
          {services.map(s => (
            <div key={s} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink">{SERVICE_LABELS[s]}</p>
                <p className="text-xs text-muted">
                  {pageCount} {pageCount === 1 ? 'página' : 'páginas'}
                </p>
              </div>
              <span className={`text-sm font-semibold ${isFree ? 'line-through text-muted' : 'text-ink'}`}>
                {formatBRL(calcPrice(s, pageCount))}
              </span>
            </div>
          ))}

          {/* Trial discount line */}
          {isTrial && !isFree && (
            <div className="flex items-center justify-between text-forest">
              <div className="flex items-center gap-1.5">
                <Gift size={13} />
                <p className="text-sm">1 página grátis</p>
              </div>
              <span className="text-sm font-semibold">−{formatBRL(trialDiscountBRL(services))}</span>
            </div>
          )}

          {isFree && (
            <div className="flex items-center justify-between text-forest">
              <div className="flex items-center gap-1.5">
                <Gift size={13} />
                <p className="text-sm">Período gratuito</p>
              </div>
              <span className="text-sm font-semibold">−100%</span>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border flex items-center justify-between">
          <span className="text-sm font-semibold text-ink">Total</span>
          <span className="text-base font-bold text-ink">
            {isFree ? 'Grátis' : formatBRL(finalTotal)}
          </span>
        </div>
      </div>

      {/* File deletion notice */}
      <div className="flex items-start gap-2.5 mb-6">
        <Clock size={13} className="text-muted shrink-0 mt-0.5" />
        <p className="text-xs text-muted leading-relaxed">
          Seus arquivos (original e processado) serão excluídos automaticamente 30 dias após a conclusão do projeto.{' '}
          <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink transition-colors">
            Saiba mais
          </a>
          .
        </p>
      </div>

      {/* Payment section */}
      <div className="bg-white rounded-2xl border border-border p-6">
        <p className="text-xs font-medium text-muted uppercase tracking-widest mb-5">Pagamento</p>

        {fetchError ? (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{fetchError}</p>
        ) : !intentData ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
          </div>
        ) : isFree ? (
          <FreeOrderButton
            services={services}
            pageCount={pageCount}
            userId={user!.id}
            onSuccess={(orderId) => {
              setIsFreeOrder(true)
              handleSuccess(orderId)
            }}
          />
        ) : clientSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <PaymentForm
              totalBRL={finalTotal}
              onSuccess={() => handleSuccess()}
            />
          </Elements>
        ) : null}
      </div>
    </div>
  )
}
