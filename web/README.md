# FormaTexto — Web Frontend

React + TypeScript + Vite frontend for FormaTexto, an AI-powered document
formatting and proofreading service for academic documents (Brazil-first, ABNT).

For architecture, design system, routes, and conventions, see **[`../CLAUDE.md`](../CLAUDE.md)**.
The backend lives in [`../server`](../server) and the formatting pipeline is
documented in [`../docs/formatting-pipeline.md`](../docs/formatting-pipeline.md).

## Stack

React 19 · TypeScript (strict) · Vite · React Router v7 · Tailwind CSS v3 ·
shadcn/ui (Radix) · Supabase (auth + DB + storage) · Stripe · i18next.

## Dev commands

```sh
npm install
npm run dev      # Vite dev server → http://localhost:5173
npm run build    # tsc -b + vite build
npm run lint     # ESLint
npm run preview  # preview the production build
```

## Environment

Create `web/.env.local` (gitignored). Ask a teammate for the values.

```sh
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
VITE_API_URL=http://localhost:3001   # backend base URL
```

The frontend runs without the backend for most UI work; the payment flow and
trial-eligibility checks need the server on port 3001.
