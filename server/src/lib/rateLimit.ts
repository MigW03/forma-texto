import rateLimit from 'express-rate-limit'

/**
 * Per-IP rate limits on the two routes that trigger real external cost per call:
 * `/api/processing/start` (OpenRouter + LibreOffice) and the checkout routes
 * (Stripe). Cheap insurance against cost/abuse for a small early-access launch —
 * not a substitute for auth-level throttling later.
 *
 * `req.ip` is the direct socket address unless `app.set('trust proxy', …)` is
 * configured to match the deploy target's proxy topology (Vercel, a Docker host
 * behind nginx, etc.) — deliberately left unset here since no host is chosen yet
 * (see HANDOFF.md). Behind an unconfigured reverse proxy every request shares the
 * proxy's IP, so the limit degrades to a single shared budget rather than
 * per-visitor; still strictly better than no limit, but `trust proxy` must be set
 * correctly once a host is picked or this silently under-limits.
 */
const WINDOW_MS = 15 * 60 * 1000

export const processingLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many processing requests from this address — please try again later.' },
})

export const checkoutLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many checkout requests from this address — please try again later.' },
})
