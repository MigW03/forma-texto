# FormaTexto

## What Is This

FormaTexto is an AI-powered document formatting and proofreading service. Users upload a `.docx` or `.pdf`, choose services (academic formatting and/or grammatical revision/correction), select which pages to process, and pay. The backend processes the file using a multi-model AI pipeline — making the service faster and cheaper than traditional human-based alternatives.

## Repository Layout

- **[`HANDOFF.md`](HANDOFF.md)** — living snapshot of current project state, gotchas, and open work. **Read it first**, and update it at the end of each session.
- **`web/`** — React + Vite frontend (this file is mostly about it). See [`web/README.md`](web/README.md).
- **`server/`** — Express + TypeScript backend: Stripe, Supabase service-role, email, and the DOCX formatting pipeline.
- **`docs/`** — architecture docs. The formatting pipeline is documented in [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md).
- **`business_decisions/`** — decision records (designed HTML, see Quick Reports).

## Communication Style

**Conversational responses** (code help, explanations, debugging): use `/caveman full` — terse, fragment-style, no filler. Active always. Off only on "stop caveman" / "normal mode".

**Writing or editing `.md` files**: use clear, readable prose. Full sentences, no jargon compression. These files are read by humans, not just AI. Use `/caveman light`.

## Quick Reports

When asked to produce a report, comparison, or decision document for the user to read (not code), default to a **designed standalone HTML file**, not plain markdown. Save decision records in `business_decisions/`.

Reference template: [`business_decisions/n8n-vs-server.html`](business_decisions/n8n-vs-server.html). Match its approach:
- **Answer up front** — dark header band, a status/recommendation pill, and a verdict card + scorecard so the conclusion lands in seconds.
- **Consistent color language** — pick one accent for the recommended option (forest green), a contrasting tone for the alternative (amber), neutral for ties; reuse it across tags, table chips, and timeline dots so the lean is readable without reading.
- **Scannable structure** — eyebrow labels over sections, comparison tables with a "favors" chip column, reasoning as individual cards (verdict tag pinned right), flows as connected timelines (not ASCII).
- Use the project design tokens (sand/ink/forest/muted/border), Inter font, rounded cards, self-contained embedded CSS, responsive.
- Keep it a **report, not a landing page** — no marketing fluff or scroll animation. Write report prose in clear readable language (not caveman).

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite |
| Routing | React Router v7 |
| Styling | Tailwind CSS v3 |
| UI components | shadcn/ui (Radix primitives) in `components/ui/` |
| Auth + DB | Supabase |
| Payments | Stripe (`@stripe/react-stripe-js`) |
| i18n | i18next + react-i18next |
| Icons | lucide-react |
| Doc processing | pdfjs-dist, pdf-lib, docx-preview, fflate |
| Backend | Express + TypeScript (`server/`) |

**No Redux, no Zustand.** State = React Context + local `useState` + `sessionStorage` for multi-step flow.

---

## Design System — ALWAYS FOLLOW THIS

Full design system in [`DESIGN.md`](DESIGN.md). Summary below.

UI is built on **shadcn/ui** primitives (`components/ui/`: button, card, badge, input, label) — the official component layer. Compose and extend those primitives rather than hand-rolling new base elements, and always style them with the design tokens below.

### Colors

```js
// tailwind.config.js
sand:         '#F0EEE8'  // warm off-white — page background
forest:       '#1A3C2E'  // deep green — primary CTA, avatar bg
forest-mid:   '#2D5A3F'  // medium green — hover states
forest-light: '#3D7A57'  // light green — accents
ink:          '#1A1A18'  // near-black — headings, primary text, primary buttons
muted:        '#6B6B60'  // secondary text, icons
border:       '#DDDBD3'  // subtle borders
```

**Use color tokens, never raw hex values.** `bg-ink` not `bg-[#1A1A18]`.

Exception: Tailwind doesn't support opacity on custom tokens natively → `bg-forest/10`, `text-ink/90` OK.

### Typography

- **Font**: Inter (400, 500, 600). Georgia serif for emphasis only.
- Headings: `text-2xl font-semibold text-ink` minimum
- Body: `text-sm text-ink` or `text-sm text-muted`
- Labels/captions: `text-xs text-muted`
- No bold prose outside headings

### Spacing & Layout

- Max content width: `max-w-3xl mx-auto px-6` (pages), `max-w-6xl mx-auto px-6` (navbar)
- Section padding: `py-12` for pages
- Gap between cards: `gap-3`
- Internal card padding: `px-6 py-5`

### Border Radius

- Cards/panels: `rounded-2xl` (16px)
- Buttons, inputs, badges: `rounded-xl` (12px) or `rounded-lg` (8px)
- Icon containers: `rounded-xl`
- Logo mark: `rounded-md`

### Shadows

- Subtle depth only: `shadow-sm`. No heavy shadows.

### Buttons

Primary (dark):
```tsx
className="bg-ink text-[#F0EEE8] text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-ink/90 transition-colors"
```

Secondary/ghost: text links with `text-muted hover:text-ink transition-colors`.

CTA (forest):
```tsx
className="bg-forest text-white text-sm font-medium px-4 py-2.5 rounded-xl hover:bg-forest-mid transition-colors"
```

### Cards

White card on sand background:
```tsx
className="bg-white rounded-2xl border border-border px-6 py-5"
```

Interactive card (hover highlight):
```tsx
className="bg-white rounded-2xl border border-border px-6 py-5 hover:border-forest-mid/40 transition-colors group"
```

### Badges

Status badges — follow `STATUS_CLASS` pattern from `DashboardPage.tsx`:
```ts
inQueue:    'bg-[#F0EEE8] text-muted border border-border'
processing: 'bg-amber-50 text-amber-700 border border-amber-200'
ready:      'bg-forest/10 text-forest border border-forest/20'
delivered:  'bg-forest text-white border border-forest'
```

Generic badge:
```tsx
className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg bg-[#F0EEE8] text-ink border border-border"
```

### Icon Containers

```tsx
className="w-10 h-10 rounded-xl bg-[#F0EEE8] flex items-center justify-center"
// icon inside: size={18} className="text-muted"
```

### Loading Skeleton

```tsx
className="bg-white rounded-2xl border border-border px-6 py-5 h-[72px] animate-pulse"
```

### Navbar Pattern

Sticky, `z-50`, frosted glass: `bg-[#F0EEE8]/90 backdrop-blur-sm border-b border-[#DDDBD3]`. Height `h-16`.

---

## Folder Structure

```
web/src/
├── components/
│   ├── layout/
│   │   ├── Navbar.tsx          — sticky top nav, auth-aware
│   │   └── LanguageSwitcher.tsx
│   ├── sections/              — landing-page sections (Hero, Services, Pricing)
│   ├── ui/                    — shadcn/ui primitives (button, card, badge, input, label)
│   └── ProtectedRoute.tsx      — redirects unauthenticated → /sign-in
├── pages/
│   ├── LandingPage.tsx
│   ├── AuthPage.tsx            — sign-in + sign-up (mode prop)
│   ├── ForgotPasswordPage.tsx
│   ├── GetStartedPage.tsx      — step 1: service + file upload
│   ├── PageSelectionPage.tsx   — step 2: pick which pages
│   ├── CheckoutPage.tsx        — step 3: Stripe payment
│   ├── DashboardPage.tsx       — project list
│   ├── ProjectDetailPage.tsx   — /projects/:id
│   ├── ProfilePage.tsx         — /profile (account details)
│   ├── TermsPage.tsx
│   └── PrivacyPage.tsx
├── lib/
│   ├── auth-context.tsx        — AuthProvider + useAuth()
│   ├── supabase.ts             — Supabase client (env vars)
│   ├── routes.ts               — ROUTES constants
│   ├── i18n.ts                 — i18next config, 3 locales
│   ├── guidelines.ts           — useGuidelines() hook (catalog from /api/guidelines)
│   ├── pdf-slice.ts            — pdf-lib page slicer
│   ├── docx-slice.ts           — DOCX virtual page slicer
│   ├── file-store.ts           — client-side temp file ref
│   └── pricing.ts              — price calculations
└── locales/
    ├── en.json
    ├── pt-BR.json
    └── pt-PT.json
```

Backend structure lives under `server/src/` (`routes/`, `lib/`, `lib/formatting/`); see [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md).

---

## Routes

```ts
// web/src/lib/routes.ts
'/'               → LandingPage (→ /dashboard if authed)
'/sign-in'        → AuthPage mode="sign-in"
'/sign-up'        → AuthPage mode="sign-up"
'/forgot-password'→ ForgotPasswordPage
'/get-started'    → GetStartedPage (protected)
'/page-selection' → PageSelectionPage (protected)
'/checkout'       → CheckoutPage (protected)
'/dashboard'      → DashboardPage (protected)
'/projects/:id'   → ProjectDetailPage (protected)
'/profile'        → ProfilePage (protected)
'/terms'          → TermsPage
'/privacy'        → PrivacyPage
```

Always use `ROUTES` constants, never string literals.

---

## Auth

`AuthProvider` wraps entire app in `App.tsx`. Supabase `onAuthStateChange` drives state.

```tsx
const { user, session, loading, signOut } = useAuth()
```

- `loading` = true until `INITIAL_SESSION` fires (handles OAuth redirects)
- `ProtectedRoute` checks `loading` + `user` → redirects to `/sign-in`
- OAuth: Google only. Redirects back to `origin + '/'`
- Password reset: `supabase.auth.resetPasswordForEmail()`

---

## Supabase

```ts
// web/src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
)
```

### Database Schema

Full table definitions in [`supabase_tables.md`](supabase_tables.md). Quick ref:

- **projects** — core table. `id`, `user_id`, `title`, `original_file_name`, `original_file_path`, `processed_file_path`, `services` (text[]), `guideline`, `status` (`pending|processing|complete` — the backend stamps `complete` and the UI gates the final download on it), `page_count`, `selected_pages`, `references_pages`, `order_id`, `created_at`, `completed_at`, `delete_files_at`, `files_deleted_at`. (References stay inline in the single original file; the old `references_file_path` column has been removed.)
- **orders** — payment record. `id`, `stripe_payment_intent_id`, `user_id`, `services`, `page_count`, `amount_brl`, `status`, `is_trial`, `created_at`
- **user_profiles** — one row per user. `id`, `trial_used_at` (null = trial available; set on first free order)

Storage bucket: `projects`. Upload path: `{userId}/{filename}`. Processed output: `processed_file_path` on the project row.

---

## Backend API

Express server in `server/`, base URL `VITE_API_URL` (default `http://localhost:3001`). Main routes:

```
POST /api/checkout/create-payment-intent   { services, pageCount, userId }
  → { clientSecret?, isTrial?, discountBRL?, isFree?, error? }
POST /api/checkout/complete-free-order      { services, pageCount, userId }
  → { orderId, error? }                     (re-verifies trial server-side)
POST /api/webhook                           Stripe events (raw body) → inserts order
POST /api/processing/start                  { projectId } → 202; runs formatting pipeline
                                            (auth: owner Bearer token OR x-webhook-secret)
GET  /api/guidelines                        catalog from specs/*.md (drives dropdown)
POST /api/notifications/project-ready       { projectId } → sends "ready" email (x-webhook-secret)
GET  /api/documents/fetch?url=              Google Docs → .docx binary
POST /api/auth/notify-password-change       password-changed email (Bearer)
```

The formatting pipeline behind `/api/processing/start` is documented in [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md). Secrets (Stripe secret key, Supabase **service-role** key, Resend, OpenRouter) live only in `server/.env` — never in the frontend.

---

## Multi-Step Flow State

GetStarted → PageSelection → Checkout pass state via:
1. `useNavigate` with `location.state`
2. `sessionStorage` key `SESSION_KEY` (exported from `GetStartedPage.tsx`)

Clear session on dashboard load: `sessionStorage.removeItem(SESSION_KEY)`.

---

## Pricing

```ts
// web/src/lib/pricing.ts
formatting:    R$1/page, R$5 minimum
proofreading:  R$2/page, R$15 minimum
```

Trial: 1 free page per user. Gate: `user_profiles.trial_used_at` is null → eligible. Backend sets it on `complete-free-order`. `isTrial` flag in payment-intent response signals discount to frontend.

---

## i18n

Languages: `en`, `pt-BR`, `pt-PT`. Detection: `localStorage` key `formatexto.lang`, fallback browser.

```tsx
const { t } = useTranslation()
t('dashboard.title')
```

All user-visible strings go through `t()`. Never hardcode UI text.

---

## Document Processing (client-side)

- **PDF slicing**: `pdf-lib` copies the selected pages into a new `File` (`pdf-slice.ts`).
- **DOCX slicing**: 40 blocks per virtual page → filter the XML → re-zip into a new `File` (`docx-slice.ts`).
- **Page count**: PDF via `pdfjs-dist` `getDocument().numPages`; DOCX via `docProps/app.xml` `<Pages>` (with a `docx-preview` render fallback).

The academic formatting/correction itself runs server-side — see [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md).

---

## Environment Variables

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_STRIPE_PUBLISHABLE_KEY
VITE_API_URL
```

All accessed via `import.meta.env.VITE_*`. File: `web/.env.local`.

---

## Dev Commands

```sh
cd web
npm run dev      # Vite dev server
npm run build    # tsc + vite build
npm run lint     # ESLint
npm run preview  # preview prod build
```

---

## New Collaborator Setup

- **Frontend:** `cd web && npm install && npm run dev` (→ http://localhost:5173). Env vars in `web/.env.local` (see [`web/README.md`](web/README.md)).
- **Backend:** runs separately on port 3001; env in `server/.env` (copy from `server/.env.example`). The frontend works without it for most UI work, but the payment flow and trial checks need it.
- **Prerequisites:** Node.js ≥ 18, npm ≥ 9.
- **Communication style:** the caveman style (see above) activates automatically when an agent reads this file; if responses drift verbose, say _"use caveman full mode"_.

---

## Target Market

Brazil-first. Implications:
- Currency: BRL (R$). Never display USD.
- Payment methods: card + PIX only. Boleto not supported.
- Academic guidelines: ABNT is default/most common. APA, MLA, Chicago also supported.
- Primary locale: `pt-BR`. `pt-PT` and `en` secondary.
- File retention: files auto-delete 30 days after submission (`delete_files_at`). UI should communicate urgency to download processed file.

---

## Key Rules

1. **Design system mandatory** — always use color tokens, border radii, card patterns above. No deviation.
2. **shadcn/ui is the component layer** — build on the primitives in `components/ui/`, styled with the design tokens. Don't hand-roll base elements that a primitive already covers.
3. **No Redux** — local state + Context + sessionStorage only.
4. **Always use `ROUTES` constants** — never hardcode paths.
5. **Always use `t()` for UI text** — update `locales/*.json` when adding strings.
6. **TypeScript strict** — no `any`, no unused vars.
7. **`ProtectedRoute` wraps all auth-required pages** — already wired in `App.tsx`.
8. **Tests:** the server has a vitest suite (`cd server && npm test`) — keep it green. The frontend has no test suite yet (planned).
9. **Keep `PLAN.md` current** — after every major feature implementation, bug fix, or test, mark the corresponding pre-existing task as completed (`[ ]` → `[x]`) and update its description to reflect what was actually built. Never add new tasks during this update — only mark what already existed. New tasks go in a separate, deliberate edit.
