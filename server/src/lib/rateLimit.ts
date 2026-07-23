import rateLimit from 'express-rate-limit'

/**
 * Per-IP rate limits on the two routes that trigger real external cost per call:
 * `/api/processing/start` (OpenRouter + LibreOffice) and the checkout routes
 * (Stripe). Cheap insurance against cost/abuse for a small early-access launch —
 * not a substitute for auth-level throttling later.
 *
 * `req.ip` is the direct socket address unless `trust proxy` is configured to match
 * the deploy target's proxy topology (Vercel, a Docker host behind nginx, etc.). That
 * is now driven by the `TRUST_PROXY` env var in `index.ts` (unset = off for local dev).
 * Behind an unconfigured reverse proxy every request shares the proxy's IP, so the
 * limit degrades to a single shared budget rather than per-visitor; still strictly
 * better than no limit, but `TRUST_PROXY` must be set correctly once a host is picked
 * or this silently under-limits.
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

/**
 * For endpoints that trigger an outbound side effect per call — the Google Docs
 * fetch proxy (`/api/documents/fetch`) and the password-change email
 * (`/api/auth/notify-password-change`). Keeps either from being hammered.
 */
export const sensitiveLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests from this address — please try again later.' },
})
