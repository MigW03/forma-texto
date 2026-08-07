import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import checkoutRouter from './routes/checkout'
import webhookRouter from './routes/webhook'
import documentsRouter from './routes/documents'
import authRouter from './routes/auth'
import notificationsRouter from './routes/notifications'
import processingRouter from './routes/processing'
import guidelinesRouter from './routes/guidelines'
import maintenanceRouter from './routes/maintenance'
import { recoverStuckJobs } from './lib/retryPendingJobs'

const app = express()
const PORT = process.env.PORT ?? 3001

// Don't advertise the framework.
app.disable('x-powered-by')

// Trust proxy is OFF by default: blindly trusting X-Forwarded-For lets a client spoof
// its IP and sidestep the per-IP rate limits. Once a host is chosen, set TRUST_PROXY to
// the number of proxy hops in front of the app (e.g. `1` for Vercel/Render/one nginx) so
// `req.ip` resolves to the real client. `TRUST_PROXY=true` trusts all hops — only safe
// when every upstream is under your control.
const trustProxy = process.env.TRUST_PROXY
if (trustProxy) {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true')
}

// Baseline security headers for the JSON API (no HTML is served, so CSP isn't needed here).
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('Cross-Origin-Resource-Policy', 'same-origin')
  // Only advertise HSTS when actually served over HTTPS (behind a TLS-terminating proxy).
  if (process.env.TRUST_PROXY) {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  next()
})

// Webhook must receive raw body for Stripe signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter)

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') res.set('Access-Control-Allow-Private-Network', 'true')
  next()
})
// Vercel gives every branch/PR its own unique preview URL, so a single static origin can't
// cover them all. FRONTEND_URL (comma-separated) covers exact origins — production domain,
// custom domain, local dev — and any *.vercel.app origin prefixed with the project name is
// also allowed, so preview deployments can call the API without a config change per branch.
const exactOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const vercelPreviewOrigin = /^https:\/\/scriba(-[a-z0-9-]+)*\.vercel\.app$/

app.use(cors({
  origin(origin, callback) {
    // No Origin header (server-to-server calls, curl, health checks) — allow.
    if (!origin) return callback(null, true)
    if (exactOrigins.includes(origin) || vercelPreviewOrigin.test(origin)) {
      return callback(null, true)
    }
    callback(new Error(`Origin not allowed: ${origin}`))
  },
}))
// Cap JSON body size — finalize-inputs/recover-file bodies are small; the large payloads
// (documents) travel as multipart to Supabase Storage directly, not through this API.
app.use(express.json({ limit: '1mb' }))

app.use('/api/checkout', checkoutRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/auth', authRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/processing', processingRouter)
app.use('/api/guidelines', guidelinesRouter)
app.use('/api/maintenance', maintenanceRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  // A prior process crash/restart can leave a job stuck 'processing' forever (no
  // per-step checkpoint to resume from) — reset it back to 'pending' right away
  // instead of waiting for the daily retry-pending cron to also pick it up.
  recoverStuckJobs().then((result) => {
    if (result.recovered > 0 || result.errors.length > 0) {
      console.log(`[boot] recover-stuck: scanned ${result.scanned}, recovered ${result.recovered}, errors ${result.errors.length}`)
    }
  }).catch((err) => console.error('[boot] recover-stuck failed (non-fatal)', err))
})
