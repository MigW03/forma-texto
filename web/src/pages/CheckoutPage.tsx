import { useState, useEffect } from 'react'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { Check, ArrowLeft, Gift, Clock, Loader2, CreditCard, AlertTriangle } from 'lucide-react'
import { calcPrice, trialDiscountBRL, formatBRL, type ServiceKey } from '../lib/pricing'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import { getStoredFile, clearStoredFile } from '../lib/file-store'
import { sliceDocxByLaudas, getDocxBlocks } from '../lib/docx-slice'
import { uploadKeepSet } from '../lib/laudas'
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
    // `replace` so the paid /checkout page is dropped from history — pressing Back from
    // the dashboard must not return the user to the (already-completed) payment page.
    const t = setTimeout(() => navigate(ROUTES.dashboard, { replace: true }), 3000)
    return () => clearTimeout(t)
  }, [navigate])

  return (
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="w-14 h-14 rounded-full bg-forest flex items-center justify-center">
        <Check size={26} className="text-white" aria-hidden="true" />
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
      <Loader2 size={32} className="text-forest animate-spin" aria-hidden="true" />
      <p className="text-base font-semibold text-ink">Salvando seu documento…</p>
      <p className="text-sm text-muted">Só um momento.</p>
    </div>
  )
}

// ── Missing-file screen (payment succeeded, upload didn't survive the flow) ────

function MissingFileScreen({ projectId }: { projectId: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertTriangle size={26} className="text-amber-600" aria-hidden="true" />
      </div>
      <p className="text-base font-semibold text-ink">Pagamento confirmado!</p>
      <p className="text-sm text-muted max-w-sm">
        Mas não conseguimos localizar seu arquivo — isso pode acontecer se a página foi
        recarregada durante o pagamento. Você não será cobrado novamente: só precisa
        reenviar o mesmo documento para iniciar o processamento.
      </p>
      <Link
        to={ROUTES.project.replace(':id', projectId)}
        className="mt-2 inline-flex items-center justify-center py-3 px-6 rounded-xl text-sm font-semibold bg-forest text-white hover:bg-forest-mid transition-colors"
      >
        Reenviar arquivo
      </Link>
    </div>
  )
}

// ── Saved payment method ────────────────────────────────────────────────────────

export interface SavedCard {
  id: string
  brand: string
  last4: string
  expMonth: number | null
  expYear: number | null
}

// ── Payment form (needs Elements context) ─────────────────────────────────────

function PaymentForm({
  clientSecret,
  totalBRL,
  savedMethods,
  onSuccess,
}: {
  clientSecret: string
  totalBRL: number
  savedMethods: SavedCard[]
  onSuccess: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  // Default to the first saved card (one click, no re-typing) when there is one;
  // 'new' shows the full card form instead.
  const [selectedId, setSelectedId] = useState<string>(savedMethods[0]?.id ?? 'new')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Opt-in only — never save the card unless the user explicitly checks this.
  const [saveCard, setSaveCard] = useState(false)

  const usingSaved = selectedId !== 'new'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe) return

    setSubmitting(true)
    setError(null)

    // Confirming with a saved card needs no mounted PaymentElement at all — Stripe
    // confirms directly against the client secret. Stripe itself rejects this if
    // `selectedId` doesn't actually belong to the PaymentIntent's customer, so there's
    // nothing for the client (or our server) to double-check beforehand.
    if (usingSaved) {
      const { error: confirmError } = await stripe.confirmPayment({
        clientSecret,
        confirmParams: {
          payment_method: selectedId,
          return_url: `${window.location.origin}${ROUTES.checkout}`,
        },
        redirect: 'if_required',
      })
      if (confirmError) {
        setError(confirmError.message ?? 'Erro no pagamento')
        setSubmitting(false)
        return
      }
      onSuccess()
      return
    }

    if (!elements) return

    const { error: submitError } = await elements.submit()
    if (submitError) {
      setError(submitError.message ?? 'Erro no pagamento')
      setSubmitting(false)
      return
    }

    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}${ROUTES.checkout}`,
        ...(saveCard ? { payment_method_options: { card: { setup_future_usage: 'off_session' } } } : {}),
      },
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {savedMethods.length > 0 && (
        <div role="radiogroup" aria-label="Forma de pagamento" className="flex flex-col gap-2">
          {savedMethods.map(m => {
            const selected = selectedId === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSelectedId(m.id)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-colors text-left ${
                  selected ? 'border-forest bg-forest/[0.04]' : 'border-border hover:border-forest-mid/40'
                }`}
              >
                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                  selected ? 'border-forest' : 'border-border'
                }`}>
                  {selected && <div className="w-1.5 h-1.5 rounded-full bg-forest" />}
                </div>
                <CreditCard size={15} className="text-muted shrink-0" aria-hidden="true" />
                <span className="text-sm text-ink">
                  •••• {m.last4}
                  <span className="text-muted">
                    {' '}({m.brand}){m.expMonth && m.expYear
                      ? ` · ${String(m.expMonth).padStart(2, '0')}/${m.expYear}`
                      : ''}
                  </span>
                </span>
              </button>
            )
          })}
          <button
            type="button"
            role="radio"
            aria-checked={selectedId === 'new'}
            onClick={() => setSelectedId('new')}
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-colors text-left ${
              selectedId === 'new' ? 'border-forest bg-forest/[0.04]' : 'border-border hover:border-forest-mid/40'
            }`}
          >
            <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              selectedId === 'new' ? 'border-forest' : 'border-border'
            }`}>
              {selectedId === 'new' && <div className="w-1.5 h-1.5 rounded-full bg-forest" />}
            </div>
            <span className="text-sm text-ink">Usar novo cartão</span>
          </button>
        </div>
      )}

      {!usingSaved && (
        <>
          {/* Our own checkbox is the consent UI for saving a card — suppress Stripe's
              own auto-generated notice (`terms: 'auto'` shows it by default whenever a
              customer is attached to the intent, which we always do for saved-card list). */}
          <PaymentElement options={{ layout: 'tabs', paymentMethodOrder: ['card'], terms: { card: 'never' } }} />
          <label className="flex items-center gap-3 cursor-pointer group select-none">
            <div className="relative shrink-0">
              <input
                type="checkbox"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                className="peer sr-only"
              />
              <div className="w-4 h-4 rounded border border-border bg-white peer-checked:bg-forest peer-checked:border-forest transition-colors group-hover:border-forest-mid/60" />
              {saveCard && (
                <Check size={10} className="absolute inset-0 m-auto text-white pointer-events-none" aria-hidden="true" />
              )}
            </div>
            <span className="text-sm text-ink">Salvar cartão para futuras compras</span>
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !stripe}
        aria-busy={submitting}
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
  onSuccess,
}: {
  services: ServiceKey[]
  pageCount: number
  onSuccess: (orderId: string) => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFree() {
    setSubmitting(true)
    setError(null)
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token
      const res = await fetch(`${API_URL}/api/checkout/complete-free-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        // userId is derived server-side from the token; no longer sent in the body.
        body: JSON.stringify({ services, pageCount }),
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
        <Gift size={16} className="text-forest shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-forest leading-relaxed">
          Seu documento tem apenas 1 lauda. Com o período gratuito, você não paga nada agora.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleFree}
        disabled={submitting}
        aria-busy={submitting}
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
  /** Billed unit count = number of selected laudas. */
  pageCount: number
  /** Total laudas in the document (for record/display). */
  laudaCount?: number
  /** Selected lauda numbers (1-based). Slicing recomputes laudas from the file. */
  selectedLaudas?: number[]
  guideline?: string
  fileName?: string | null
  title?: string
  formatReferences?: boolean
}

type IntentResponse =
  | { isFree: true; isTrial: true }
  // orderId is present for a freshly created intent; absent only on the redirect-return
  // reconstruction (which shows a status screen and never creates a project).
  | { clientSecret: string; orderId?: string; isTrial: boolean; discountBRL: number }
  | { error: string }

type PageStatus = 'idle' | 'saving' | 'done' | 'file-missing'

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
  const [savedMethods, setSavedMethods] = useState<SavedCard[]>([])
  const [missingFileProjectId, setMissingFileProjectId] = useState<string | null>(null)

  const services = state?.services ?? []
  const pageCount = state?.pageCount ?? 0

  const fullTotal = services.reduce((sum, s) => sum + calcPrice(s, pageCount), 0)
  const isTrial = intentData && 'isTrial' in intentData ? intentData.isTrial : false
  const discountBRL = intentData && 'discountBRL' in intentData ? intentData.discountBRL : 0
  const finalTotal = Math.max(fullTotal - discountBRL, 0)

  useEffect(() => {
    if (returnedClientSecret) return
    if (!user || services.length === 0 || pageCount < 1) return

    // Guard against StrictMode's double-invoke (and any other re-run before this
    // effect's request lands): without it, two PaymentIntents/orders can be created
    // for one checkout, and — since Stripe's <Elements> only binds to whichever
    // clientSecret was set on its first mount — a later run's response can silently
    // overwrite `intentData` with an order the payment form was never actually shown
    // for. The project then gets stamped with an unpaid order and the payment gate
    // (rightfully) blocks processing forever. Checking `cancelled` before the fetch
    // call (not just before the setState) also means a cancelled run never reaches
    // the server at all in the common case, so no orphaned PaymentIntent/order is
    // created for it either.
    let cancelled = false

    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      services,
      pageCount,
      laudaCount: state?.laudaCount,
      selectedLaudas: state?.selectedLaudas ?? [],
      guideline: state?.guideline,
      fileName: state?.fileName,
      formatReferences: state?.formatReferences,
    }))

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return undefined
      return fetch(`${API_URL}/api/checkout/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        // userId is derived server-side from the token; no longer sent in the body.
        body: JSON.stringify({ services, pageCount }),
      })
    })
      .then(r => r?.json())
      .then((data?: IntentResponse) => {
        if (cancelled || !data) return
        if ('error' in data) setFetchError(data.error)
        else setIntentData(data)
      })
      .catch(() => { if (!cancelled) setFetchError('Não foi possível conectar ao servidor') })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Saved cards, so a returning user isn't asked to retype one every checkout.
  // Independent of the intent fetch above — a free/trial order never needs this,
  // but fetching it unconditionally is harmless and keeps this effect simple.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session?.access_token) return undefined
      return fetch(`${API_URL}/api/checkout/payment-methods`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
    })
      .then(r => r?.json())
      .then((data?: { paymentMethods?: SavedCard[] }) => {
        if (cancelled || !data) return
        setSavedMethods(data.paymentMethods ?? [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user])

  // ── Post-payment: upload file + create project ──────────────────────────────

  async function handleSuccess(orderId?: string) {
    if (!user) return
    setPageStatus('saving')

    let fileMissing = false
    let createdProjectId: string | null = null

    try {
      const rawFile = await getStoredFile()
      const selectedLaudas = state?.selectedLaudas ?? []
      const laudaCount = state?.laudaCount ?? 0
      const projectId = crypto.randomUUID()
      let storagePath: string | null = null
      const fileName = rawFile?.name ?? state?.fileName ?? null

      // 1. Prepare the file to upload — slice to the selected laudas (references
      //    included). References stay inline; the server's Step B detects the
      //    references section by heading text inside the single document.
      // Laudas are recomputed from the file's XML here so the block indices match
      // the slicer (the preview's lauda numbers map 1:1 by the same word boundaries).
      // When all laudas are selected, skip slicing and upload the full file as-is.
      const allSelected = laudaCount > 0 && selectedLaudas.length === laudaCount
      let fileToUpload: File | null = rawFile
      if (rawFile && selectedLaudas.length > 0 && !allSelected) {
        try {
          const blocks = await getDocxBlocks(rawFile)
          // Pré-textuais are excluded from laudas (same as page selection) but always
          // kept in the slice, so the front matter reaches the server intact.
          const keep = uploadKeepSet(blocks, selectedLaudas)
          fileToUpload = await sliceDocxByLaudas(rawFile, keep)
        } catch (err) {
          console.error('Lauda slicing failed, uploading full file:', err)
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
        // Selected lauda numbers, kept for record/display (the file is already
        // sliced to these laudas; the server does not re-slice).
        selected_pages: selectedLaudas.length > 0 ? selectedLaudas : null,
        status: 'pending',
        original_file_name: fileName,
        original_file_path: storagePath,
        // Sentinel [0] tells the server to auto-detect the references heading by
        // text. References are always located this way in lauda (continuous) mode.
        references_pages: state?.formatReferences === true ? [0] : null,
        delete_files_at: deleteAt,
        title: state?.title?.trim() || fileName || null,
      })

      if (projectError) {
        console.error('Project creation failed:', projectError)
      } else {
        createdProjectId = projectId
        // Surfaced to the user below instead of silently showing "Pagamento confirmado!"
        // as if the file made it — the project still gets created (and processing still
        // triggered, next) so the payment is never orphaned; the pipeline itself would
        // otherwise flag this `missing_file` anyway, just without the user knowing yet.
        if (!storagePath) fileMissing = true

        // 5. Trigger processing (fire-and-forget). Formatting and proofreading both
        //    run on our server's pipeline now (proofreading is no longer on n8n).
        if (services.includes('formatting') || services.includes('proofreading')) {
          const token = (await supabase.auth.getSession()).data.session?.access_token
          fetch(`${API_URL}/api/processing/start`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ projectId }),
          }).catch(() => {})
        }
      }
    } catch (err) {
      console.error('Post-payment error:', err)
    }

    await clearStoredFile()
    sessionStorage.removeItem(SESSION_KEY)
    if (fileMissing && createdProjectId) {
      setMissingFileProjectId(createdProjectId)
      setPageStatus('file-missing')
    } else {
      setPageStatus('done')
    }
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
            <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
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

  if (pageStatus === 'file-missing' && missingFileProjectId) {
    return (
      <div className="max-w-lg mx-auto px-6 py-12 pt-32">
        <MissingFileScreen projectId={missingFileProjectId} />
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
  const paidOrderId = intentData && 'orderId' in intentData ? intentData.orderId : undefined

  return (
    <div className="max-w-lg mx-auto px-6 py-12">
      <Link
        to={ROUTES.getStarted}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink transition-colors mb-8"
      >
        <ArrowLeft size={14} aria-hidden="true" />
        Voltar
      </Link>

      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-semibold text-ink">Finalizar pedido</h1>
        {isTrial && (
          <span role="status" className="inline-flex items-center gap-1 text-xs font-semibold text-forest bg-forest/10 border border-forest/20 rounded-full px-2.5 py-1">
            <Gift size={11} aria-hidden="true" />
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
                  {pageCount} {pageCount === 1 ? 'lauda' : 'laudas'}
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
                <Gift size={13} aria-hidden="true" />
                <p className="text-sm">1 lauda grátis</p>
              </div>
              <span className="text-sm font-semibold">−{formatBRL(trialDiscountBRL(services))}</span>
            </div>
          )}

          {isFree && (
            <div className="flex items-center justify-between text-forest">
              <div className="flex items-center gap-1.5">
                <Gift size={13} aria-hidden="true" />
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
        <Clock size={13} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
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
          <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{fetchError}</p>
        ) : !intentData ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
          </div>
        ) : isFree ? (
          <FreeOrderButton
            services={services}
            pageCount={pageCount}
            onSuccess={(orderId) => {
              setIsFreeOrder(true)
              handleSuccess(orderId)
            }}
          />
        ) : clientSecret ? (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
            <PaymentForm
              clientSecret={clientSecret}
              totalBRL={finalTotal}
              savedMethods={savedMethods}
              onSuccess={() => handleSuccess(paidOrderId)}
            />
          </Elements>
        ) : null}
      </div>
    </div>
  )
}
