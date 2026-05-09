import { Router, Request, Response } from 'express'
import { stripe } from '../lib/stripe'
import { supabase } from '../lib/supabase'

export type ServiceKey = 'formatting' | 'proofreading'

const PRICING: Record<ServiceKey, { perPage: number; minimum: number }> = {
  formatting: { perPage: 1, minimum: 5 },
  proofreading: { perPage: 2, minimum: 15 },
}

const VALID_SERVICES = new Set<ServiceKey>(['formatting', 'proofreading'])

function calcCentavos(service: ServiceKey, pageCount: number): number {
  const { perPage, minimum } = PRICING[service]
  return Math.round(Math.max(pageCount * perPage, minimum) * 100)
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

router.post('/create-payment-intent', async (req: Request, res: Response) => {
  const { services, pageCount, userId } = req.body as {
    services: ServiceKey[]
    pageCount: number
    userId: string
  }

  if (!Array.isArray(services) || services.length === 0 || services.some(s => !VALID_SERVICES.has(s))) {
    res.status(400).json({ error: 'Invalid services' })
    return
  }
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    res.status(400).json({ error: 'pageCount must be a positive integer' })
    return
  }
  if (!userId) {
    res.status(400).json({ error: 'userId is required' })
    return
  }

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

  const paymentIntent = await stripe.paymentIntents.create({
    amount: totalCentavos,
    currency: 'brl',
    metadata: {
      services: services.join(','),
      pageCount: String(pageCount),
      userId,
      isTrial: String(isTrial),
    },
  })

  res.json({
    clientSecret: paymentIntent.client_secret,
    isTrial,
    discountBRL: discountCentavos / 100,
  })
})

// ── Complete free trial order (no payment) ────────────────────────────────────

router.post('/complete-free-order', async (req: Request, res: Response) => {
  const { services, pageCount, userId } = req.body as {
    services: ServiceKey[]
    pageCount: number
    userId: string
  }

  if (!Array.isArray(services) || services.length === 0 || services.some(s => !VALID_SERVICES.has(s))) {
    res.status(400).json({ error: 'Invalid services' })
    return
  }
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    res.status(400).json({ error: 'pageCount must be a positive integer' })
    return
  }
  if (!userId) {
    res.status(400).json({ error: 'userId is required' })
    return
  }

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

// ── Notify internal webhook after order complete ──────────────────────────────

router.post('/notify', async (_req: Request, res: Response) => {
  const url = process.env.WEBHOOK_URL
  if (url) {
    fetch(url).catch(err => console.error('Webhook notify failed:', err))
  }
  res.json({ ok: true })
})

export default router
