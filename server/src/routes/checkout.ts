import { Router, Request, Response } from 'express'
import { stripe } from '../lib/stripe'
import { supabase } from '../lib/supabase'
import { checkoutLimiter, sensitiveLimiter } from '../lib/rateLimit'
import { getOrCreateStripeCustomerId, getStripeCustomerId } from '../lib/stripeCustomer'

export type ServiceKey = 'formatting' | 'proofreading'

const PRICING: Record<ServiceKey, { perPage: number; minimum: number }> = {
  formatting: { perPage: 1, minimum: 5 },
  proofreading: { perPage: 2, minimum: 15 },
}

const VALID_SERVICES = new Set<ServiceKey>(['formatting', 'proofreading'])

// Sanity ceiling on a single order's page count. A real thesis is ~hundreds of pages;
// this only exists to reject absurd values (e.g. 1e9) that would mint a junk order/PI.
const MAX_PAGE_COUNT = 5000

function calcCentavos(service: ServiceKey, pageCount: number): number {
  const { perPage, minimum } = PRICING[service]
  return Math.round(Math.max(pageCount * perPage, minimum) * 100)
}

/**
 * Validate + normalize the request's services and pageCount. Dedupes services (a
 * crafted body could send the same service twice and be double-charged) and bounds
 * pageCount to a positive integer within MAX_PAGE_COUNT. Returns null if invalid.
 */
function parseOrderInput(body: unknown): { services: ServiceKey[]; pageCount: number } | null {
  const { services, pageCount } = (body ?? {}) as { services?: unknown; pageCount?: unknown }
  if (!Array.isArray(services) || services.length === 0) return null
  if (services.some(s => !VALID_SERVICES.has(s as ServiceKey))) return null
  const unique = [...new Set(services as ServiceKey[])]
  if (!Number.isInteger(pageCount) || (pageCount as number) < 1 || (pageCount as number) > MAX_PAGE_COUNT) return null
  return { services: unique, pageCount: pageCount as number }
}

/**
 * Resolve the caller's own user id from the Supabase access token. The checkout
 * routes act on behalf of a specific user (trial eligibility, order attribution),
 * so the id MUST come from the verified token — never a client-supplied body field,
 * which any caller could set to another user's id (burn their trial, attribute
 * orders to them). Returns null when the token is missing or invalid.
 */
async function getUserIdFromRequest(req: Request): Promise<string | null> {
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null
  if (!token) return null
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

/** Fast trial check via user_profiles.trial_used_at */
async function isTrialEligible(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('trial_used_at')
    .eq('id', userId)
    .single()
  if (error) {
    console.error('Trial check failed:', error)
    return false
  }
  return data.trial_used_at === null
}

/** Stamp trial as used */
async function consumeTrial(userId: string): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .update({ trial_used_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) console.error('Failed to consume trial:', error)
}

const router = Router()

// ── Create payment intent ─────────────────────────────────────────────────────

router.post('/create-payment-intent', checkoutLimiter, async (req: Request, res: Response) => {
  // userId comes from the verified access token, not the request body.
  const userId = await getUserIdFromRequest(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const parsed = parseOrderInput(req.body)
  if (!parsed) {
    res.status(400).json({ error: 'Invalid services or pageCount' })
    return
  }
  const { services, pageCount } = parsed

  const isTrial = await isTrialEligible(userId)

  // Single page + trial → completely free, no payment intent needed
  if (isTrial && pageCount === 1) {
    res.json({ isFree: true, isTrial: true })
    return
  }

  // Compute totals
  const fullCentavos = services.reduce((sum, s) => sum + calcCentavos(s, pageCount), 0)
  const discountCentavos = isTrial
    ? services.reduce((sum, s) => sum + PRICING[s].perPage * 100, 0)
    : 0
  const totalCentavos = Math.max(fullCentavos - discountCentavos, 0)

  // Attach the user's Stripe Customer so a card can be saved for reuse — but only when
  // the user explicitly opts in via the checkbox on the client. That decision is sent
  // per-confirm as `payment_method_options.card.setup_future_usage`, not set here on the
  // intent, so a card is never saved without consent. Which saved card (if any) the user
  // picks is decided entirely client-side at confirm time by passing `payment_method`
  // directly to `stripe.confirmPayment` — Stripe itself rejects the confirm if that
  // payment method doesn't belong to this customer, so there's nothing for this endpoint
  // to validate up front.
  const customerId = await getOrCreateStripeCustomerId(userId)

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalCentavos,
    currency: 'brl',
    customer: customerId,
    metadata: {
      services: services.join(','),
      pageCount: String(pageCount),
      userId,
      isTrial: String(isTrial),
    },
  })

  // Create the order row up-front as `pending` and hand its id back so the client
  // can stamp it on the project. The webhook flips it to `paid` on success; the
  // processing gate (see processing.ts) only runs the pipeline for a paid/free_trial
  // order, so a project can't be processed without a real payment. The unique
  // order_id on projects binds one payment to exactly one project (no replay).
  const { data: orderRow, error: orderErr } = await supabase
    .from('orders')
    .insert({
      stripe_payment_intent_id: paymentIntent.id,
      user_id: userId,
      services,
      page_count: pageCount,
      amount_brl: totalCentavos / 100,
      status: 'pending',
      is_trial: isTrial,
    })
    .select('id')
    .single()

  if (orderErr || !orderRow) {
    console.error('Failed to create pending order:', orderErr)
    res.status(500).json({ error: 'Failed to create order' })
    return
  }

  res.json({
    clientSecret: paymentIntent.client_secret,
    orderId: orderRow.id,
    isTrial,
    discountBRL: discountCentavos / 100,
  })
})

// ── Complete free trial order (no payment) ────────────────────────────────────

router.post('/complete-free-order', checkoutLimiter, async (req: Request, res: Response) => {
  // userId comes from the verified access token, not the request body.
  const userId = await getUserIdFromRequest(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const parsed = parseOrderInput(req.body)
  if (!parsed) {
    res.status(400).json({ error: 'Invalid services or pageCount' })
    return
  }
  const { services, pageCount } = parsed

  // Re-verify trial eligibility server-side — never trust the client
  const eligible = await isTrialEligible(userId)
  if (!eligible) {
    res.status(403).json({ error: 'Free trial already used' })
    return
  }
  if (pageCount !== 1) {
    res.status(400).json({ error: 'Free order only valid for single-page documents' })
    return
  }

  const { data: orderData, error } = await supabase
    .from('orders')
    .insert({
      user_id: userId,
      services,
      page_count: pageCount,
      amount_brl: 0,
      status: 'free_trial',
      is_trial: true,
    })
    .select('id')
    .single()

  if (error || !orderData) {
    console.error('Failed to record free order:', error)
    res.status(500).json({ error: 'Failed to record order' })
    return
  }

  await consumeTrial(userId)
  res.json({ success: true, orderId: orderData.id })
})

// ── Saved payment methods ──────────────────────────────────────────────────────

router.get('/payment-methods', checkoutLimiter, async (req: Request, res: Response) => {
  const userId = await getUserIdFromRequest(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const customerId = await getStripeCustomerId(userId)
  if (!customerId) {
    // Never paid before (or the very first checkout hasn't created a Customer yet) —
    // an empty list, not an error.
    res.json({ paymentMethods: [] })
    return
  }

  const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' })
  res.json({
    // Only ever hand the client the minimum needed to render "•••• 4242, exp 12/28" —
    // never anything else Stripe's object carries (billing address, fingerprint, …).
    paymentMethods: methods.data.map(pm => ({
      id: pm.id,
      brand: pm.card?.brand ?? 'card',
      last4: pm.card?.last4 ?? '',
      expMonth: pm.card?.exp_month ?? null,
      expYear: pm.card?.exp_year ?? null,
    })),
  })
})

router.post('/payment-methods/:id/detach', sensitiveLimiter, async (req: Request, res: Response) => {
  const userId = await getUserIdFromRequest(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const pmId = req.params.id
  if (typeof pmId !== 'string' || !/^pm_\w+$/.test(pmId)) {
    res.status(400).json({ error: 'Invalid payment method id' })
    return
  }

  const customerId = await getStripeCustomerId(userId)
  if (!customerId) {
    res.status(404).json({ error: 'Not found' })
    return
  }

  // Ownership check: the payment method must belong to THIS user's Stripe customer.
  // Never trust the :id path param alone — any authenticated caller could otherwise
  // detach an arbitrary payment method (someone else's saved card) just by knowing or
  // guessing its id. A 404 either way (missing vs. not-yours) avoids confirming to a
  // non-owner that a given id even exists.
  try {
    const method = await stripe.paymentMethods.retrieve(pmId)
    if (method.customer !== customerId) {
      res.status(404).json({ error: 'Not found' })
      return
    }
  } catch {
    res.status(404).json({ error: 'Not found' })
    return
  }

  await stripe.paymentMethods.detach(pmId)
  res.json({ success: true })
})

// ── Notify internal webhook after order complete ──────────────────────────────

router.post('/notify', async (_req: Request, res: Response) => {
  const url = process.env.WEBHOOK_URL
  if (url) {
    fetch(url).catch(err => console.error('Webhook notify failed:', err))
  }
  res.json({ ok: true })
})

export default router
