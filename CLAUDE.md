# FormaTexto — Web Frontend

## What Is This

FormaTexto is an AI-powered document formatting and proofreading service. Users upload a `.docx` or `.pdf`, choose services (academic formatting and/or grammatical revision/correction), select which pages to process, and pay. The backend processes the file using a multi-model AI pipeline — making the service faster and cheaper than traditional human-based alternatives.

## Communication Style

**Conversational responses** (code help, explanations, debugging): use `/caveman full` — terse, fragment-style, no filler. Active always. Off only on "stop caveman" / "normal mode".

**Writing or editing `.md` files**: use clear, readable prose. Full sentences, no jargon compression. These files are read by humans, not just AI. Use `/caveman light`.

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite |
| Routing | React Router v7 |
| Styling | Tailwind CSS v3 |
| Auth + DB | Supabase |
| Payments | Stripe (`@stripe/react-stripe-js`) |
| i18n | i18next + react-i18next |
| Icons | lucide-react |
| Doc processing | pdfjs-dist, mammoth, pdf-lib, tesseract.js, fflate |

**No Redux, no Zustand.** State = React Context + local `useState` + `sessionStorage` for multi-step flow.

---

## Design System — ALWAYS FOLLOW THIS

Full design system in [`DESIGN.md`](DESIGN.md). Summary below.

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
│   ├── TermsPage.tsx
│   └── TextExtractPage.tsx     — exists, no route yet
├── lib/
│   ├── auth-context.tsx        — AuthProvider + useAuth()
│   ├── supabase.ts             — Supabase client (env vars)
│   ├── routes.ts               — ROUTES constants
│   ├── i18n.ts                 — i18next config, 3 locales
│   ├── extract.ts              — PDF/DOCX text extraction
│   ├── pdf-slice.ts            — pdf-lib page slicer
│   ├── docx-slice.ts           — DOCX virtual page slicer
│   ├── file-store.ts           — client-side temp file ref
│   └── pricing.ts              — price calculations
└── locales/
    ├── en.json
    ├── pt-BR.json
    └── pt-PT.json
```

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
'/terms'          → TermsPage
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

- **projects** — core table. `id`, `user_id`, `title`, `original_file_name`, `original_file_path`, `processed_file_path`, `services` (text[]), `guideline`, `status` (`pending|processing|ready|delivered`), `page_count`, `selected_pages`, `order_id`, `created_at`, `completed_at`, `delete_files_at`, `files_deleted_at`
- **orders** — payment record. `id`, `stripe_payment_intent_id`, `user_id`, `services`, `page_count`, `amount_brl`, `status`, `is_trial`, `created_at`
- **user_profiles** — one row per user. `id`, `trial_used_at` (null = trial available; set on first free order)

Storage bucket: `projects`. Upload path: `{userId}/{filename}`. Processed output: `processed_file_path` on the project row.

---

## Backend API

Base URL: `VITE_API_URL` (default `http://localhost:3001`)

```
POST /api/checkout/create-payment-intent
  body: { services: string[], pageCount: number, userId: string }
  resp: { clientSecret?, isTrial?, discountBRL?, isFree?, error? }

POST /api/checkout/complete-free-order
  body: { services: string[], pageCount: number, userId: string }
  resp: { orderId: string, error? }
```

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

## Document Processing

- **PDF text**: `pdfjs-dist` → by Y-position → classify by font size (h1/h2/h3/paragraph/caption)
- **DOCX text**: unzip → parse `<w:t>` XML → detect headings by style ID
- **PDF slicing**: `pdf-lib` copies selected pages → new `File`
- **DOCX slicing**: 40 blocks/virtual-page → filter XML → re-zip → new `File`
- **Page count (PDF)**: regex `/Count` on raw bytes. DOCX: `docProps/app.xml` `<Pages>`

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

## Environment Setup (New Collaborator)

> **AI agent instruction:** Before walking through these steps, ask the user directly: _"Have you already set up Node.js, installed dependencies, and configured the environment variables? Or are we starting from scratch?"_ Skip steps they confirm are already done.

### 1. Prerequisites

- **Node.js** ≥ 18 (project uses Vite 8 + React 19 + TypeScript 6)
- **npm** ≥ 9
- Any AI coding agent that can read this file (Claude Code, Cursor, Copilot, Windsurf, etc.)

### 2. Install Frontend Dependencies

```sh
cd web
npm install
```

### 3. Configure Environment Variables

Create `web/.env.local` — this file is gitignored. Ask a teammate for the values.

```sh
VITE_SUPABASE_URL=              # Supabase project URL
VITE_SUPABASE_PUBLISHABLE_KEY=  # Supabase anon/publishable key
VITE_STRIPE_PUBLISHABLE_KEY=    # Stripe publishable key (pk_test_... or pk_live_...)
VITE_API_URL=http://localhost:3001  # Backend API base URL
```

### 4. Start the Dev Server

```sh
cd web
npm run dev
# → http://localhost:5173
```

### 5. Backend

The backend runs separately on port `3001`. See the backend folder for its own setup instructions. The frontend works without it for most UI work, but payment flow and trial eligibility checks will fail.

### 6. AI Agent Skills

This project uses the **caveman** communication style for conversational responses (terse, no filler). If your agent supports installable skills, install the caveman skill before starting:

```sh
# Claude Code
/install-skill caveman
```

For other agents, the style rules are defined in the **Communication Style** section of this file — paste them into your agent's system prompt or custom instructions if needed.

The style activates automatically when the agent reads this `CLAUDE.md`. If responses drift verbose, remind the agent: _"use caveman full mode"_.

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
2. **No component library (current branch)** — all UI built custom with Tailwind. Shadcn migration planned for a future branch — do not introduce it here.
3. **No Redux** — local state + Context + sessionStorage only.
4. **Always use `ROUTES` constants** — never hardcode paths.
5. **Always use `t()` for UI text** — update `locales/*.json` when adding strings.
6. **TypeScript strict** — no `any`, no unused vars.
7. **`ProtectedRoute` wraps all auth-required pages** — already wired in `App.tsx`.
8. **Missing**: `TextExtractPage` has no route. `PrivacyPage` has route but no file. No tests configured.
9. **Keep `PLAN.md` current** — after every major feature implementation, bug fix, or test, mark the corresponding pre-existing task as completed (`[ ]` → `[x]`) and update its description to reflect what was actually built. Never add new tasks during this update — only mark what already existed. New tasks go in a separate, deliberate edit.
