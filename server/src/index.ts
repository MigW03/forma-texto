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

// Webhook must receive raw body for Stripe signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter)

app.use((req, res, next) => {
  if (req.method === 'OPTIONS') res.set('Access-Control-Allow-Private-Network', 'true')
  next()
})
app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }))
app.use(express.json())

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
