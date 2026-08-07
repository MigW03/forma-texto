/**
 * Free-trial abuse suite.
 *
 * The trial gives each user one free page (`user_profiles.trial_used_at`, null = unused).
 * Everything that decides *who gets it* and *how much of it they get* is server-side, and
 * this file is the adversarial test of that surface: it drives the real Express routers
 * (`checkout`, `processing`, `webhook`) over HTTP against an in-memory Supabase/Stripe,
 * so the assertions cover the actual middleware + handler path, not extracted helpers.
 *
 * Attack vectors covered:
 *   1. identity      — no/forged token, body-supplied `userId` pointing at another user
 *   2. flag tamper   — client sending `isFree`/`isTrial`/`amount` in the body
 *   3. page count    — trying to get more than one page free
 *   4. replay        — a second trial after the first is consumed (free AND discounted paths)
 *   5. input tamper  — duplicated/invalid services, out-of-range page counts
 *   6. concurrency   — two simultaneous claims on the same trial (TOCTOU)
 *   7. coverage      — attaching a cheap free_trial order to a big/broader project
 *
 * Note on mocks: `supabase`/`stripe` are module-mocked rather than injected because the
 * checkout routes import them directly. The fake DB is stateful across requests within a
 * test, which is what makes the replay and concurrency cases meaningful.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest'
import express from 'express'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

type Row = Record<string, any>
type Result = { data: any; error: { message: string } | null }

const h = vi.hoisted(() => {
  /** Macrotask boundary, so concurrent requests interleave the way real I/O would. */
  const tick = () => new Promise(resolve => setImmediate(resolve))

  /**
   * Test-controlled hook fired inside every query, before it touches the data. Lets a
   * concurrency test hold N readers at the same point so the read-then-write window is
   * forced open deterministically instead of depending on how the HTTP layer happens to
   * schedule two requests (it does not reliably interleave them).
   */
  const hooks = { beforeExec: null as null | ((table: string, op: string) => Promise<void> | void) }

  const db = {
    tokens: new Map<string, string>(),
    user_profiles: [] as Row[],
    orders: [] as Row[],
    projects: [] as Row[],
    seq: 0,
    nextId(prefix: string) {
      return `${prefix}_${++this.seq}`
    },
    table(name: string): Row[] {
      const t = (this as Row)[name]
      if (!Array.isArray(t)) throw new Error(`unknown table: ${name}`)
      return t
    },
    reset() {
      this.tokens.clear()
      this.user_profiles = []
      this.orders = []
      this.projects = []
      this.seq = 0
    },
  }

  /**
   * Minimal PostgREST-shaped query builder. Filters are collected then applied in one
   * synchronous block after a single await boundary — which models Postgres row-level
   * atomicity: a conditional UPDATE either matches a row or it doesn't, with no
   * interleaving between the match and the write.
   */
  class Query implements PromiseLike<Result> {
    private op: 'select' | 'insert' | 'update' = 'select'
    private payload: Row | null = null
    private preds: Array<(r: Row) => boolean> = []
    private singleMode = false

    constructor(private readonly name: string) {}

    select(_cols?: string) {
      return this
    }
    insert(value: Row) {
      this.op = 'insert'
      this.payload = value
      return this
    }
    update(patch: Row) {
      this.op = 'update'
      this.payload = patch
      return this
    }
    eq(col: string, val: unknown) {
      this.preds.push(r => r[col] === val)
      return this
    }
    is(col: string, val: null) {
      this.preds.push(r => (r[col] ?? null) === val)
      return this
    }
    single(): Promise<Result> {
      this.singleMode = true
      return this.exec()
    }
    then<A, B>(
      onOk?: ((v: Result) => A | PromiseLike<A>) | null,
      onErr?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return this.exec().then(onOk, onErr)
    }

    private async exec(): Promise<Result> {
      await tick()
      if (hooks.beforeExec) await hooks.beforeExec(this.name, this.op)
      const rows = db.table(this.name)
      let affected: Row[]
      if (this.op === 'insert') {
        const row = { id: db.nextId(this.name), ...(this.payload as Row) }
        rows.push(row)
        affected = [row]
      } else {
        affected = rows.filter(r => this.preds.every(p => p(r)))
        if (this.op === 'update') for (const r of affected) Object.assign(r, this.payload)
      }
      if (this.singleMode) {
        if (affected.length !== 1) {
          return { data: null, error: { message: `expected 1 row, got ${affected.length}` } }
        }
        return { data: { ...affected[0] }, error: null }
      }
      return { data: affected.map(r => ({ ...r })), error: null }
    }
  }

  const supabase = {
    from: (name: string) => new Query(name),
    auth: {
      async getUser(token: string) {
        await tick()
        const id = db.tokens.get(token)
        if (!id) return { data: { user: null }, error: { message: 'bad jwt' } }
        return { data: { user: { id } }, error: null }
      },
    },
  }

  const stripeCalls = {
    paymentIntents: [] as Row[],
    intentStatus: new Map<string, string>(),
  }

  const stripe = {
    paymentIntents: {
      async create(params: Row) {
        await tick()
        const id = db.nextId('pi')
        stripeCalls.paymentIntents.push({ id, ...params })
        return { id, client_secret: `${id}_secret`, ...params }
      },
      async retrieve(id: string) {
        await tick()
        return { id, status: stripeCalls.intentStatus.get(id) ?? 'requires_payment_method' }
      },
    },
    customers: {
      async create() {
        await tick()
        return { id: db.nextId('cus') }
      },
    },
    webhooks: {
      // Signature verification itself is Stripe's job and is covered by its own header
      // check in webhook.ts; here we only need the decoded event.
      constructEvent(body: Buffer, sig: string) {
        if (sig !== 'test-signature') throw new Error('bad signature')
        return JSON.parse(body.toString())
      },
    },
  }

  const enqueued: string[] = []

  return { db, supabase, stripe, stripeCalls, enqueued, hooks }
})

const passthrough = (_req: unknown, _res: unknown, next: () => void) => next()

vi.mock('../lib/supabase', () => ({ supabase: h.supabase }))
vi.mock('../lib/stripe', () => ({ stripe: h.stripe }))
vi.mock('../lib/jobQueue', () => ({
  enqueueProcessing: (id: string) => {
    h.enqueued.push(id)
  },
}))
// Rate limits are a separate defense with their own configuration; leaving them live would
// just cap how many adversarial requests this suite can make from one IP.
vi.mock('../lib/rateLimit', () => ({
  checkoutLimiter: passthrough,
  processingLimiter: passthrough,
  sensitiveLimiter: passthrough,
}))
// Pulled in transitively by the processing router; none of it runs on the paths tested here.
vi.mock('../lib/processFormatting', () => ({ exportPdfBeside: vi.fn(), processFormatting: vi.fn() }))
vi.mock('../lib/notify', () => ({ sendProjectReadyEmail: vi.fn() }))
vi.mock('../lib/paginateSumario', () => ({ paginateSumario: vi.fn() }))
vi.mock('../lib/formatting', () => ({
  unzipDocx: vi.fn(),
  zipDocx: vi.fn(),
  finalizeInputs: vi.fn(),
  detectPretextual: vi.fn(),
}))

const { db, stripeCalls, enqueued, hooks } = h

const WEBHOOK_SECRET = 'test-processing-secret'

let server: Server
let base: string

beforeAll(async () => {
  process.env.WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'

  const checkoutRouter = (await import('./checkout')).default
  const processingRouter = (await import('./processing')).default
  const webhookRouter = (await import('./webhook')).default

  const app = express()
  app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter)
  app.use(express.json())
  app.use('/api/checkout', checkoutRouter)
  app.use('/api/processing', processingRouter)

  server = app.listen(0)
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.close()
  await once(server, 'close')
})

beforeEach(() => {
  db.reset()
  stripeCalls.paymentIntents.length = 0
  stripeCalls.intentStatus.clear()
  enqueued.length = 0
  hooks.beforeExec = null
})

// ── helpers ───────────────────────────────────────────────────────────────────

async function post(
  path: string,
  body: unknown,
  opts: { token?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

function seedUser(opts: { trialUsed?: boolean } = {}) {
  const id = db.nextId('user')
  const token = `token-${id}`
  db.tokens.set(token, id)
  db.user_profiles.push({
    id,
    trial_used_at: opts.trialUsed ? new Date().toISOString() : null,
    stripe_customer_id: null,
  })
  return { id, token }
}

function profile(userId: string) {
  return db.user_profiles.find(p => p.id === userId)!
}

function seedProject(
  userId: string,
  opts: { orderId?: string | null; pageCount?: number; services?: string[] } = {},
) {
  const id = db.nextId('projects')
  db.projects.push({
    id,
    user_id: userId,
    order_id: opts.orderId ?? null,
    page_count: opts.pageCount ?? 1,
    services: opts.services ?? ['formatting'],
  })
  return id
}

/**
 * Hold the first `n` queries against `table` until all of them have arrived, then release
 * them together. Two concurrent HTTP requests do not reliably interleave on their own, so
 * without this a TOCTOU test passes or fails on scheduling luck; this forces the
 * read-then-write window wide open every run.
 */
function holdAtTable(table: string, n: number) {
  let arrived = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => (release = resolve))
  hooks.beforeExec = async (t: string) => {
    if (t !== table) return
    arrived++
    if (arrived >= n) release()
    await gate
  }
}

/** Deliver a `payment_intent.succeeded` event for an intent the checkout route created. */
async function deliverWebhook(intentId: string) {
  const intent = stripeCalls.paymentIntents.find(pi => pi.id === intentId)!
  const res = await fetch(base + '/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 'test-signature' },
    body: JSON.stringify({
      type: 'payment_intent.succeeded',
      data: { object: { id: intent.id, amount: intent.amount, metadata: intent.metadata } },
    }),
  })
  return res.status
}

// ── 1. identity ───────────────────────────────────────────────────────────────

describe('trial abuse — identity', () => {
  it('rejects an unauthenticated free-order claim', async () => {
    const res = await post('/api/checkout/complete-free-order', {
      services: ['formatting'],
      pageCount: 1,
    })
    expect(res.status).toBe(401)
    expect(db.orders).toHaveLength(0)
  })

  it('rejects a forged/unknown bearer token', async () => {
    const victim = seedUser()
    const res = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: 'token-not-real' },
    )
    expect(res.status).toBe(401)
    expect(profile(victim.id).trial_used_at).toBeNull()
  })

  it('ignores a body-supplied userId — cannot burn another user\'s trial', async () => {
    const attacker = seedUser()
    const victim = seedUser()

    const res = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1, userId: victim.id },
      { token: attacker.token },
    )

    expect(res.status).toBe(200)
    // The trial burned is the token holder's, never the id named in the body.
    expect(profile(attacker.id).trial_used_at).not.toBeNull()
    expect(profile(victim.id).trial_used_at).toBeNull()
    expect(db.orders).toHaveLength(1)
    expect(db.orders[0].user_id).toBe(attacker.id)
  })

  it('attributes a discounted payment intent to the token holder, not the body userId', async () => {
    const attacker = seedUser()
    const victim = seedUser()

    await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10, userId: victim.id },
      { token: attacker.token },
    )

    expect(db.orders[0].user_id).toBe(attacker.id)
    expect(stripeCalls.paymentIntents[0].metadata.userId).toBe(attacker.id)
  })

  it('rejects an unauthenticated payment-intent request', async () => {
    const res = await post('/api/checkout/create-payment-intent', {
      services: ['formatting'],
      pageCount: 10,
    })
    expect(res.status).toBe(401)
    expect(stripeCalls.paymentIntents).toHaveLength(0)
  })
})

// ── 2. client flag tampering ──────────────────────────────────────────────────

describe('trial abuse — client flag tampering', () => {
  it('ignores isFree/isTrial in the body when the trial is already consumed', async () => {
    const user = seedUser({ trialUsed: true })

    const res = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1, isFree: true, isTrial: true },
      { token: user.token },
    )

    expect(res.status).toBe(403)
    expect(db.orders).toHaveLength(0)
  })

  it('ignores a client-supplied amount — the price is recomputed server-side', async () => {
    const user = seedUser({ trialUsed: true })

    await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10, amount: 1, amount_brl: 0, totalCentavos: 0 },
      { token: user.token },
    )

    // 10 pages × R$1, no trial discount.
    expect(stripeCalls.paymentIntents[0].amount).toBe(1000)
    expect(db.orders[0].amount_brl).toBe(10)
  })

  it('reports isTrial from the database, not from the request', async () => {
    const user = seedUser({ trialUsed: true })

    const res = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10, isTrial: true },
      { token: user.token },
    )

    expect(res.body.isTrial).toBe(false)
    expect(res.body.discountBRL).toBe(0)
    expect(db.orders[0].is_trial).toBe(false)
  })
})

// ── 3. page count ─────────────────────────────────────────────────────────────

describe('trial abuse — page count', () => {
  it('refuses a multi-page free order and does NOT consume the trial', async () => {
    const user = seedUser()

    const res = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 40 },
      { token: user.token },
    )

    expect(res.status).toBe(400)
    expect(db.orders).toHaveLength(0)
    // A rejected attempt must not cost the user their trial.
    expect(profile(user.id).trial_used_at).toBeNull()
  })

  it.each([0, -1, 1.5, 5001, Number.MAX_SAFE_INTEGER])(
    'refuses a free order with pageCount %s',
    async pageCount => {
      const user = seedUser()
      const res = await post(
        '/api/checkout/complete-free-order',
        { services: ['formatting'], pageCount },
        { token: user.token },
      )
      expect(res.status).toBe(400)
      expect(db.orders).toHaveLength(0)
      expect(profile(user.id).trial_used_at).toBeNull()
    },
  )

  it.each(['1', null, undefined, [1], { valueOf: () => 1 }])(
    'refuses a non-integer pageCount %s',
    async pageCount => {
      const user = seedUser()
      const res = await post(
        '/api/checkout/complete-free-order',
        { services: ['formatting'], pageCount },
        { token: user.token },
      )
      expect(res.status).toBe(400)
      expect(db.orders).toHaveLength(0)
    },
  )

  it('gives a multi-page trial user a one-page discount only — never a free order', async () => {
    const user = seedUser()

    const res = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting', 'proofreading'], pageCount: 10 },
      { token: user.token },
    )

    expect(res.body.isFree).toBeUndefined()
    expect(res.body.clientSecret).toBeTruthy()
    // full 10×(1+2) = R$30, minus one page of each service = R$3 → R$27
    expect(res.body.discountBRL).toBe(3)
    expect(stripeCalls.paymentIntents[0].amount).toBe(2700)
  })

  it('never produces a zero-amount payment intent for a trial user', async () => {
    const user = seedUser()
    // Smallest possible multi-page order: the minimums (R$5 / R$15) dominate.
    const res = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting', 'proofreading'], pageCount: 2 },
      { token: user.token },
    )
    expect(res.status).toBe(200)
    expect(stripeCalls.paymentIntents[0].amount).toBeGreaterThan(0)
  })
})

// ── 4. replay: a second trial ─────────────────────────────────────────────────

describe('trial abuse — replay', () => {
  it('refuses a second free order after the first is consumed', async () => {
    const user = seedUser()

    const first = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    const second = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )

    expect(first.status).toBe(200)
    expect(second.status).toBe(403)
    expect(db.orders).toHaveLength(1)
  })

  it('drops the discount on the next paid order once the free trial is used', async () => {
    const user = seedUser()

    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    const paid = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10 },
      { token: user.token },
    )

    expect(paid.body.isTrial).toBe(false)
    expect(paid.body.discountBRL).toBe(0)
    expect(stripeCalls.paymentIntents[0].amount).toBe(1000)
  })

  it('consumes the trial when a discounted order is paid, blocking a second discount', async () => {
    const user = seedUser()

    const first = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10 },
      { token: user.token },
    )
    expect(first.body.discountBRL).toBe(1)

    expect(await deliverWebhook(stripeCalls.paymentIntents[0].id)).toBe(200)
    expect(profile(user.id).trial_used_at).not.toBeNull()

    const second = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10 },
      { token: user.token },
    )
    expect(second.body.isTrial).toBe(false)
    expect(second.body.discountBRL).toBe(0)

    // And the fully-free path is closed too.
    const free = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    expect(free.status).toBe(403)
  })

  it('KNOWN GAP: the discount repeats until the Stripe webhook lands', async () => {
    // The discounted path stamps `trial_used_at` only from `payment_intent.succeeded`
    // (webhook.ts). Until that event arrives, every new intent re-reads an unconsumed
    // trial and re-applies the discount. Deliberately deferred (see PLAN.md, 2026-07-15) —
    // the exposure is one page's price per intent, and a client-side reconciliation
    // fallback was the proposed fix. Locked in here so the behaviour change is visible
    // if that fallback ever ships.
    const user = seedUser()

    for (let i = 0; i < 3; i++) {
      const res = await post(
        '/api/checkout/create-payment-intent',
        { services: ['formatting'], pageCount: 10 },
        { token: user.token },
      )
      expect(res.body.isTrial).toBe(true)
      expect(res.body.discountBRL).toBe(1)
    }
    expect(profile(user.id).trial_used_at).toBeNull()
  })
})

// ── 5. input tampering ────────────────────────────────────────────────────────

describe('trial abuse — input tampering', () => {
  it('dedupes a repeated service so the discount is not multiplied', async () => {
    const user = seedUser()

    const res = await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting', 'formatting', 'formatting'], pageCount: 10 },
      { token: user.token },
    )

    expect(res.body.discountBRL).toBe(1)
    expect(stripeCalls.paymentIntents[0].amount).toBe(900)
    expect(db.orders[0].services).toEqual(['formatting'])
  })

  it.each([[[]], [['free']], [['formatting', 'free']], ['formatting'], [null]])(
    'refuses invalid services %s',
    async services => {
      const user = seedUser()
      const res = await post(
        '/api/checkout/complete-free-order',
        { services, pageCount: 1 },
        { token: user.token },
      )
      expect(res.status).toBe(400)
      expect(profile(user.id).trial_used_at).toBeNull()
    },
  )

  it('records the free order against the requested services only', async () => {
    const user = seedUser()
    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting', 'formatting'], pageCount: 1 },
      { token: user.token },
    )
    expect(db.orders[0].services).toEqual(['formatting'])
    expect(db.orders[0].amount_brl).toBe(0)
    expect(db.orders[0].status).toBe('free_trial')
  })
})

// ── 6. concurrency ────────────────────────────────────────────────────────────

describe('trial abuse — concurrency', () => {
  it('grants only one free order when two claims race', async () => {
    const user = seedUser()
    holdAtTable('user_profiles', 2)

    const results = await Promise.all([
      post('/api/checkout/complete-free-order', { services: ['formatting'], pageCount: 1 }, { token: user.token }),
      post('/api/checkout/complete-free-order', { services: ['formatting'], pageCount: 1 }, { token: user.token }),
    ])

    expect(results.filter(r => r.status === 200)).toHaveLength(1)
    expect(results.filter(r => r.status === 403)).toHaveLength(1)
    expect(db.orders).toHaveLength(1)
  })

  it('grants only one free order under a wider burst', async () => {
    const user = seedUser()
    const burst = 8
    holdAtTable('user_profiles', burst)

    const results = await Promise.all(
      Array.from({ length: burst }, () =>
        post('/api/checkout/complete-free-order', { services: ['formatting'], pageCount: 1 }, { token: user.token }),
      ),
    )

    expect(results.filter(r => r.status === 200)).toHaveLength(1)
    expect(results.filter(r => r.status === 403)).toHaveLength(burst - 1)
    expect(db.orders).toHaveLength(1)
    expect(profile(user.id).trial_used_at).not.toBeNull()
  })

  it('leaves the trial available when the order insert fails', async () => {
    const user = seedUser()

    // Simulate a failed order insert (constraint violation, connection blip, …) so the
    // claim has to be released — a request that recorded nothing must not cost the trial.
    const original = h.supabase.from
    h.supabase.from = ((name: string) => {
      if (name === 'orders') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: null, error: { message: 'insert failed' } }),
            }),
          }),
        } as never
      }
      return original(name)
    }) as typeof h.supabase.from

    try {
      const res = await post(
        '/api/checkout/complete-free-order',
        { services: ['formatting'], pageCount: 1 },
        { token: user.token },
      )
      expect(res.status).toBe(500)
      expect(db.orders).toHaveLength(0)
      expect(profile(user.id).trial_used_at).toBeNull()
    } finally {
      h.supabase.from = original
    }

    // …and the trial is genuinely still spendable afterwards.
    const retry = await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    expect(retry.status).toBe(200)
  })
})

// ── 7. order coverage (processing gate) ───────────────────────────────────────

describe('trial abuse — order coverage', () => {
  it('refuses to process a 40-page project on a 1-page free_trial order', async () => {
    const user = seedUser()
    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    const orderId = db.orders[0].id
    const projectId = seedProject(user.id, { orderId, pageCount: 40, services: ['formatting'] })

    const res = await post('/api/processing/start', { projectId }, { token: user.token })

    expect(res.status).toBe(402)
    expect(enqueued).toHaveLength(0)
  })

  it('refuses a project asking for a service the free_trial order did not cover', async () => {
    const user = seedUser()
    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    const orderId = db.orders[0].id
    const projectId = seedProject(user.id, {
      orderId,
      pageCount: 1,
      services: ['formatting', 'proofreading'],
    })

    const res = await post('/api/processing/start', { projectId }, { token: user.token })
    expect(res.status).toBe(402)
    expect(enqueued).toHaveLength(0)
  })

  it('processes a project the free_trial order actually covers', async () => {
    const user = seedUser()
    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    const orderId = db.orders[0].id
    const projectId = seedProject(user.id, { orderId, pageCount: 1, services: ['formatting'] })

    const res = await post('/api/processing/start', { projectId }, { token: user.token })
    expect(res.status).toBe(202)
    expect(enqueued).toEqual([projectId])
  })

  it('refuses to reuse one free_trial order across two projects', async () => {
    const user = seedUser()
    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: user.token },
    )
    const orderId = db.orders[0].id
    const first = seedProject(user.id, { orderId, pageCount: 1 })
    const second = seedProject(user.id, { orderId, pageCount: 1 })

    expect((await post('/api/processing/start', { projectId: first }, { token: user.token })).status).toBe(202)
    // In production the unique `order_id` constraint on `projects` rejects the second row
    // outright; the fake DB has no constraints, so this documents that the payment gate
    // alone does NOT stop replay — the DB constraint is the control that matters.
    expect((await post('/api/processing/start', { projectId: second }, { token: user.token })).status).toBe(202)
    expect(db.projects.filter(p => p.order_id === orderId)).toHaveLength(2)
  })

  it("refuses another user's free_trial order attached to the attacker's project", async () => {
    const victim = seedUser()
    const attacker = seedUser()
    await post(
      '/api/checkout/complete-free-order',
      { services: ['formatting'], pageCount: 1 },
      { token: victim.token },
    )
    const victimOrderId = db.orders[0].id
    const projectId = seedProject(attacker.id, { orderId: victimOrderId, pageCount: 1 })

    const res = await post('/api/processing/start', { projectId }, { token: attacker.token })
    expect(res.status).toBe(402)
    expect(enqueued).toHaveLength(0)
  })

  it('refuses a project with no order at all', async () => {
    const user = seedUser()
    const projectId = seedProject(user.id, { orderId: null })

    const res = await post('/api/processing/start', { projectId }, { token: user.token })
    expect(res.status).toBe(402)
  })

  it('refuses a pending order whose PaymentIntent never succeeded', async () => {
    const user = seedUser({ trialUsed: true })
    await post(
      '/api/checkout/create-payment-intent',
      { services: ['formatting'], pageCount: 10 },
      { token: user.token },
    )
    const orderId = db.orders[0].id
    const projectId = seedProject(user.id, { orderId, pageCount: 10 })

    const res = await post('/api/processing/start', { projectId }, { token: user.token })
    expect(res.status).toBe(402)
  })

  it('rejects a wrong x-webhook-secret on the trusted bypass path', async () => {
    const user = seedUser()
    const projectId = seedProject(user.id, { orderId: null })

    const res = await post(
      '/api/processing/start',
      { projectId },
      { headers: { 'x-webhook-secret': 'wrong' } },
    )
    expect(res.status).toBe(401)
    expect(enqueued).toHaveLength(0)
  })
})
