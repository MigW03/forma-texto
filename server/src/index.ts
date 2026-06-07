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

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
