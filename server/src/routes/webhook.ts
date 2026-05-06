import { Router, Request, Response } from 'express'
import { stripe } from '../lib/stripe'
import { supabase } from '../lib/supabase'

const router = Router()

router.post('/', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature']
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set')
    res.status(500).send('Webhook secret not configured')
    return
  }
  if (!sig) {
    res.status(400).send('Missing stripe-signature header')
    return
  }

  let event: ReturnType<typeof stripe.webhooks.constructEvent>
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    res.status(400).send(`Webhook error: ${(err as Error).message}`)
    return
  }

  if (event.type === 'payment_intent.succeeded') {
    // v22: event.data.object is typed via the specific event union — cast to the fields we need
    const intent = event.data.object as {
      id: string
      amount: number
      metadata: Record<string, string>
    }

    const { services, pageCount, userId, isTrial } = intent.metadata

    const { error } = await supabase.from('orders').insert({
      stripe_payment_intent_id: intent.id,
      user_id: userId,
      services: services ? services.split(',') : [],
      page_count: pageCount ? parseInt(pageCount) : null,
      amount_brl: intent.amount / 100,
      status: 'paid',
      is_trial: isTrial === 'true',
    })

    if (error) {
      console.error('Failed to insert order:', error)
      // Return 200 so Stripe does not retry — handle separately
    }

    if (isTrial === 'true' && userId) {
      await supabase
        .from('user_profiles')
        .update({ trial_used_at: new Date().toISOString() })
        .eq('id', userId)
    }
  }

  res.json({ received: true })
})

export default router
