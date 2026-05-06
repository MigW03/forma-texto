import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import checkoutRouter from './routes/checkout'
import webhookRouter from './routes/webhook'

const app = express()
const PORT = process.env.PORT ?? 3001

// Webhook must receive raw body for Stripe signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter)

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }))
app.use(express.json())

app.use('/api/checkout', checkoutRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
