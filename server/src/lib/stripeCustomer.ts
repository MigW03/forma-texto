import { stripe } from './stripe'
import { supabase } from './supabase'

/**
 * Resolve (or lazily create) the Stripe Customer backing a Supabase user, so saved
 * cards can be attached to a stable identity across checkouts. Stored on
 * `user_profiles.stripe_customer_id` — a server-managed field: no client-side
 * Supabase query ever selects it (mirrors how `trial_used_at` is handled), so the
 * id is never exposed to the browser directly, only ever used server-side to call
 * Stripe on the authenticated user's behalf.
 */
export async function getOrCreateStripeCustomerId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single()
  if (error) throw new Error(`Failed to look up user_profiles for ${userId}: ${error.message}`)
  if (data.stripe_customer_id) return data.stripe_customer_id

  const customer = await stripe.customers.create({ metadata: { supabase_user_id: userId } })

  // Non-fatal: the customer we just created still works for this request even if this
  // write fails — a future call would just create (and persist) another one instead of
  // reusing it, which is wasteful but not a security or correctness issue.
  const { error: updateErr } = await supabase
    .from('user_profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId)
  if (updateErr) console.error(`Failed to persist stripe_customer_id for ${userId}:`, updateErr)

  return customer.id
}

/** The user's Stripe customer id, or null if they've never paid before (no customer yet). */
export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single()
  if (error) return null
  return data.stripe_customer_id
}
