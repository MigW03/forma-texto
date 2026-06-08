# FormaTexto — Feature Plan

---

## Auth

- [x] Sign up (email + password)
  - `supabase.auth.signUp()` with `full_name` in user metadata
- [x] Sign in (email + password)
  - `supabase.auth.signInWithPassword()`
- [x] Google OAuth
  - `supabase.auth.signInWithOAuth({ provider: 'google' })`, redirects back to `/`
- [x] Forgot password / reset email
  - `supabase.auth.resetPasswordForEmail()`
- [x] Protected routes (redirect unauthenticated users)
  - `ProtectedRoute` component, reads `useAuth()` context, redirects to `/sign-in`
- [x] Profile details page
  - `ProfilePage.tsx` at `/profile` (protected). Displays avatar (initials), full name, email, join date, trial status. Edit full name and email via `supabase.auth.updateUser()`; email change triggers confirmation email. Password change for email/password users only. Connected-account badge (Google vs email). Danger zone with delete-account modal (calls `POST /api/auth/delete-account` on the backend — endpoint must be implemented separately). Navbar avatar links to `/profile`.
- [ ] Delete account
  - Supabase admin API or Edge Function — requires server-side call

---

## Onboarding Flow

- [x] Service selection (proofreading, formatting)
  - Local `useState<Set<ServiceType>>` in `GetStartedPage.tsx`
- [x] Academic guideline selection (data-driven from server specs)
  - Shown conditionally when formatting is selected. The guideline list is no longer hardcoded: both the `GetStartedPage` dropdown and the `PageSelectionPage` `<select>` render from `GET /api/guidelines`, which enumerates the spec files in `server/src/lib/formatting/specs/` — one option per `{id}.md`. A shared `useGuidelines()` hook (`web/src/lib/guidelines.ts`) fetches the catalog, with a built-in ABNT fallback if the API is unreachable. The option name comes from each spec's `display.name` (universal); the description is localized to the active UI language. Dropping a new `.md` into the specs folder adds a dropdown option with no frontend change. Only `abnt.md` exists today, so the dropdown shows ABNT only.
- [x] File upload (.pdf, .docx) with drag-and-drop
  - Native HTML drag events + `<input type="file">`, stored in `file-store.ts` module closure
- [x] File type validation (.doc warning, invalid type error)
  - Extension + MIME type check in `GetStartedPage.tsx`
- [x] Automatic page count detection (PDF + DOCX)
  - PDF: `pdfjs-dist` `getDocument().numPages` (replaced old regex approach that picked up intermediate `/Count` entries from nested page tree nodes). DOCX: `fflate` unzip → parse `docProps/app.xml`, fallback to `docx-preview` render measurement
- [x] Project title field
  - Local `useState<string>`, auto-filled from filename, persisted to `sessionStorage`
- [x] Terms of service agreement checkbox
  - Local `useState<boolean>`, gates submit button
- [x] Multi-step session state preserved across pages
  - `sessionStorage` (key `SESSION_KEY`) + `useNavigate` with `location.state`
- [x] Page selection (choose which pages to process)
  - `PageSelectionPage.tsx` — renders doc preview, user picks pages, passes `selectedPages: number[]` to checkout. Service cards show name + price on the top row; pricing formula (R$/pg · mín.) on the second row, right-aligned.
- [x] URL / link input — Google Docs fetch implemented
  - `GET /api/documents/fetch?url=` in `server/src/routes/documents.ts` extracts the doc ID, hits the Google export endpoint, and returns the `.docx` binary with `X-Filename` header. `GetStartedPage.tsx` fetches it on submit, creates a `File` object, runs page count detection, and navigates to `PageSelectionPage` with the file in state — identical to a manual upload from that point on. Loading state shown while fetching. Dropbox and other providers not yet supported.

---

## Checkout & Payment

- [x] Stripe payment integration (card + PIX)
  - `@stripe/react-stripe-js` `Elements` + `PaymentElement`, `loadStripe()` with `VITE_STRIPE_PUBLISHABLE_KEY`
- [x] Free trial for first order (1 page free, gated by `user_profiles.trial_used_at`)
  - Backend checks `user_profiles.trial_used_at`; returns `isFree: true` or `discountBRL` in payment intent response
- [x] Order summary with per-service pricing
  - `calcPrice()` from `lib/pricing.ts` — R$1/pg formatting, R$2/pg proofreading, per-service minimums
- [x] Trial discount line item in summary
  - `trialDiscountBRL()` from `lib/pricing.ts`, rendered conditionally if `isTrial`
- [x] Project record created in Supabase on payment success
  - `supabase.from('projects').insert(...)` in `handleSuccess()` after Stripe confirms
- [x] Original file uploaded to Supabase Storage on payment success
  - `supabase.storage.from('projects').upload(path, file)`, path: `{userId}/{projectId}/original/{filename}`
- [x] File sliced to selected pages before upload
  - PDF: `slicePdf()` via `pdf-lib`. DOCX: `sliceDocx()` via `fflate` XML manipulation
- [x] Always display cents in price values
  - `formatBRL()` in `lib/pricing.ts` now uses `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` — always shows two decimal places (e.g. R$&nbsp;1,00). All price display sites use `formatBRL()`: checkout summary, trial discount line, order total, `GetStartedPage.tsx` pricing cards, `PageSelectionPage.tsx`, and `ProjectDetailPage.tsx`.

- [ ] Migrate to Checkout Sessions API (deferred)
  - Stripe recommends Checkout Sessions + PaymentElement over Payment Intents for new integrations. Would simplify PIX and future local payment methods. Not worth the rewrite now — revisit if PIX setup on the live account proves painful. Server changes in `checkout.ts`; frontend changes in `CheckoutPage.tsx` (swap `Elements`+`PaymentElement` for `CheckoutElementsProvider` from `@stripe/react-stripe-js/checkout`, confirm via `checkout.confirm`).

- [ ] PIX payment support
  - PIX removed from code (both `payment_method_types` on the server and `paymentMethodOrder` on the frontend) — needs to be enabled on the live Stripe account first (Settings → Payment methods), then re-add `payment_method_types: ['card', 'pix']` in `checkout.ts` and `'pix'` to `paymentMethodOrder` in `CheckoutPage.tsx`.
- [ ] Comprehensive free trial security test
  - Verify the trial cannot be abused: test that a user who selects multiple pages cannot receive the free trial (backend must reject `pageCount > 1` on `complete-free-order`); test that a user cannot trigger a second free trial after the first is consumed (`trial_used_at` is stamped and re-checked server-side on every request); test that manipulating the client-side `isFree` or `isTrial` flags in the request body has no effect since eligibility is always re-verified in `checkout.ts`; test that creating a new account to bypass `trial_used_at` does not give a second trial if the same payment method or identity is reused.

- [x] Remove boleto from Stripe `paymentMethodOrder`
  - Removed `'boleto'` from `paymentMethodOrder` in `CheckoutPage.tsx`. Now `['card', 'pix']` only.

---

## Dashboard

- [x] Project list with status badges
  - `supabase.from('projects').select(...).eq('user_id', user.id)` ordered by `created_at desc`
- [x] Service + guideline badge per project
  - `ServiceBadge` component, reads `project.services[0]` and `project.guideline`
- [x] Time-ago display (just now / X hours / X days)
  - `toTimeAgo()` utility in `DashboardPage.tsx`, translated via `i18next`
- [x] Empty state with CTA
  - `EmptyState` component in `DashboardPage.tsx`
- [x] New service button
  - Link to `/get-started`, clears `sessionStorage` on click
- [x] Real-time status updates on dashboard
  - Supabase Realtime `postgres_changes` on `projects` filtered by `user_id=eq.{id}`; badge updates in place on `UPDATE` without a page refresh.

---

## Project Detail

- [x] PDF viewer with zoom controls and lazy page rendering
  - `pdfjs-dist` with `IntersectionObserver` for lazy render, `ResizeObserver` for responsive width, DPR-aware canvas
- [x] PDF text layer (selectable text)
  - `pdfjsLib.TextLayer`, styled via `.pdf-text-layer` CSS in `index.css`
- [x] DOCX viewer with zoom controls and page separation
  - `docx-preview` `renderAsync()`, custom CSS injected for page separators and numbering. `ignoreLastRenderedPageBreak: true` fixes pages merging; post-render pass removes empty trailing sections (ghost page bug).
- [x] Project metadata panel (service, guideline, page count, cost, date)
  - Right-side panel, reads from `supabase.from('projects').select(...).eq('id', id).single()`
- [x] References section in project creation flow (PageSelectionPage)
  - Checkbox "Este documento possui uma seção de referências" (checked by default) + page range input in the right panel of `PageSelectionPage.tsx`. On checkout success: slices reference pages from the original file (PDF via `slicePdf`, DOCX via `sliceDocx`), uploads to `{userId}/{projectId}/original/references/`, stamps `references_pages` (int4[]) and `references_file_path` (text) on the project row at insert. Both columns added to `projects` table in `supabase_tables.md`. Final download merge (body + references) pending.
- [x] Download processed file button
  - Two-button layout in the details panel: primary "Baixar Arquivo Final" downloads `processed_file_path` via signed URL — visible only when `project.status === 'complete'`; tertiary "Baixar Arquivo Original" downloads the original file and appears below it. Both signed URLs fetched in parallel on load. Tertiary variant added to `Button` component (`text-muted hover:text-ink hover:bg-sand`, no border).
- [x] Viewer top bar with unified controls
  - Shared absolute top bar over the file viewer: white-pill back button, inline plain-text file version label ("Visualizando arquivo final/original", green when processed), spacer, zoom controls (right). Sand gradient fades downward behind the bar. Gradient extends `right-0 md:right-80` to avoid hard cutoff on mobile. Zoom state lifted to `ProjectDetailPage` and passed as prop to both `PdfViewer` and `DocxViewer`; `ZoomControls` extracted as a standalone component. Status badge remains in the details panel.
- [x] Processed file shown in viewer
  - `previewUrl` prefers `processedFileUrl` when `status === 'complete'`, falls back to original. Viewer re-renders automatically when processed file is available.
- [ ] *(low priority)* Real-time status badge update on project detail page
  - Subscription is wired (`channel project:${id}`, `UPDATE` on `projects` filtered by `id=eq.{id}`) but badge does not update live — likely Supabase Realtime dropping the filter due to missing index or RLS policy on `id`. Dashboard real-time works fine and covers the common case. revisit if the "Baixar Arquivo Final" button needs to appear without a page refresh.
- [ ] Show processing progress or estimated time
  - UI-only: status-based messaging, or backend-driven `progress` field added to `projects` table

---

## Notifications

- [x] Email notification when project is ready
  - `POST /api/notifications/project-ready` implemented in `server/src/routes/notifications.ts`. Auth via `x-webhook-secret` header. Triggered by n8n after stamping `status = complete`. Looks up project + user email via Supabase service role, sends via Resend (`onboarding@resend.dev` for now — swap to `noreply@formatexto.com` once domain verified). Template in `server/src/emails/projectReady.ts`.
- [ ] Improve email HTML templates
  - Templates live in `server/src/emails/`. Improve visual design: better spacing, branded header, footer with unsubscribe/legal note, responsive layout. Consider extracting a shared `layout.ts` wrapper to avoid duplicating header/footer across templates. Currently using `onboarding@resend.dev` — swap `from` address to `noreply@formatexto.com` once domain is verified in Resend.
- [ ] Welcome email on sign-up
  - Triggered by Supabase auth webhook or n8n on new user creation. Brief onboarding email: explains the service, links to `/get-started`, reminds user of the free first page. Template in `server/src/emails/welcome.ts`.
- [ ] Order confirmation / receipt email
  - Triggered after payment succeeds (checkout flow). Body: services ordered, page count, guideline, amount paid, link to project page. Can be sent directly from the Express checkout route after the project insert, or by n8n on project creation. Template in `server/src/emails/orderConfirmation.ts`.
- [ ] Respect notification preferences in backend
  - `notifications.ts` endpoint and future email senders should fetch `user_profiles.notification_preferences` before sending and skip if the relevant toggle is off. Currently all emails send unconditionally.
- [ ] In-app notification or badge for status change
  - Supabase Realtime on `projects` table, show toast or navbar badge
- [ ] File deletion warning email (7 days before expiry)
  - Triggered by scheduled job (pg_cron or Supabase Edge Function, daily). Query `projects` where `delete_files_at` is between `now()` and `now() + 7 days`, `files_deleted_at` is null, `processed_file_path` is not null, and user has not yet downloaded (no download-tracking flag yet — needs `processed_file_downloaded_at` column added to `projects`, stamped on first signed-URL fetch or download click). Send email via Resend/SendGrid with a direct link to the project page. Guard against duplicate sends with a `deletion_warning_sent_at` column on `projects`.

---

## Backend / AI Pipeline

- [ ] AI processing pipeline (receives uploaded file, runs formatting/proofreading)
  - Backend reads file from Supabase Storage, runs multi-model AI chain, writes output file back
- [x] Project status updates written back to DB (`pending` → `processing` → `ready`)
  - Backend calls `supabase.from('projects').update({ status })` at each stage
- [x] Processed file written to `processed_file_path` in Supabase Storage
  - n8n workflow uploads the processed `.docx` to `projects` bucket and updates `projects.processed_file_path`; sets `status` to `complete` when done.
- [x] Webhook or job queue to trigger processing after order created
  - n8n handles end-to-end: triggered via webhook on project insert, runs the AI pipeline, writes output back to Storage, updates DB.
- [ ] PDF formatting function
  - Read uploaded PDF, apply academic formatting rules (margins, fonts, heading hierarchy, spacing) according to selected guideline (ABNT, APA, etc.), write formatted PDF back to Storage
- [ ] PDF correction — apply corrected text to existing PDF
  - After proofreading pass produces corrected text, edit the original PDF to replace content in-place; preserve layout, fonts, and structure as much as possible
- [x] DOCX correction function
  - n8n workflow: unzips uploaded DOCX, extracts `word/document.xml`, runs AI proofreading pass, serializes corrected XML back, repacks as `.docx` and writes to Storage
- [ ] DOCX formatting function — see [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md) for full breakdown
  - Five-step pipeline: (A) deterministic — rewrite `styles.xml` per guideline, strip direct overrides, fix margins; (B) deterministic — detect references section, apply hanging indent + spacing; (C) AI — reformat reference entries to guideline citation format (Haiku/GPT-4o-mini); (D) AI — heading reclassification; (E) repack → upload → stamp DB. AI only touches semantics; layout is deterministic XML.
  - **Progress (migrating off n8n → server, per `business_decisions/n8n-vs-server.md`):** Steps A & B implemented server-side in `server/src/lib/formatting/` (pure transforms: `rewriteStyles`, `stripDirectOverrides`, `rewriteMargins` in `applyStepA`; `formatReferences` for Step B; zip via `docxZip`) + orchestrator `server/src/lib/processFormatting.ts` (download → Step A → Step B → re-zip → upload `processed/` → stamp `status='complete'` → ready email). Triggered by `POST /api/processing/start` (`x-webhook-secret`, in-process async, 202). 33 unit + real-fixture tests pass (vitest). Canonical guideline spec: `server/src/lib/formatting/specs/abnt.md` — now the **live single source of truth**: `getGuideline()` reads the spec's machine block at runtime (`loadGuideline.ts`, parsed with JSON5 + validated with zod, cached by file mtime so edits apply with no rebuild or restart), falling back to a built-in table in `guidelines.ts` only if a spec is missing or invalid. The spec also carries the `display` metadata that drives the guideline dropdown (see Onboarding). A copy step (`scripts/copySpecs.js`) ships the `.md` specs into `dist` for production builds.
  - **Architecture decision — references no longer split:** since processing left n8n, the separate references file is unnecessary. The plan is to store ONE file (selected pages incl. references); Step B detects the references section by heading text and `references_file_path` has been removed (the separate references file is gone). Step B is **bounded to the user-flagged `references_pages`** (not word-detection — "Referências" can appear in body text); flagged pages are mapped to paragraphs via pagination signals (manual page breaks / `sectPr` / `lastRenderedPageBreak` / 40-block fallback). Step C (AI reference reformatting) is confirmed in-scope for later. The ABNT heading-font reconcile is **done** — body and headings now derive from a single `fonts.default`, enforcing one font per document (Arial and Times New Roman are both ABNT-valid, but never mixed); the `abnt.md` spec was clarified accordingly. **Step D (AI heading reclassification) is done** — built server-side via OpenRouter (OpenAI-compatible) + Vercel AI SDK (`generateObject` + zod), model-agnostic behind the `HeadingDecider` seam (`stepD.ts`, `ai/headingDecider.ts`, `ai/config.ts`, `ai/headingsPrompt.ts`). Shared block parser extracted to `blocks.ts`; `locateReferences` exported from `references.ts`; spec §4 drives the prompt via `loadGuidelineDoc`/`guidelineSection`. Wired into `processFormatting` behind the `AI_FORMATTING_ENABLED` flag with graceful fallback (an AI failure keeps the deterministic A/B result). 17 new offline unit tests (fake decider, no network) + a gated live eval (`RUN_AI_EVALS=1`) that passed against `openai/gpt-oss-120b:free` (promoted 2 plain-text headings, 0 blocks lost). Per-level heading caps/bold in Step A is **done** — `rewriteStyles` builds Heading1/2/3 from the spec's `headings.levels` (H1 caps+bold, H2 caps, H3 sentence+bold; one size, ABNT differentiates by case+bold not size). Step D also logs each identified heading (tier + page) to the server console. **Still pending:** Step C (AI reference reformatting, same pattern); unnumbered-title style (RESUMO/SUMÁRIO) in Step A; migrate proofreading off n8n.
  - **Done:** frontend stores one file (references inline; the `references_file_path` column has been removed); `ProjectDetailPage` viewer handles the single file. **Trigger cutover done for formatting** — `CheckoutPage` calls `POST /api/processing/start` (Bearer = project owner's Supabase token) after the row is created; proofreading-only projects still hit the n8n `/notify`. The `/processing/start` route accepts the owner's Bearer token OR the `x-webhook-secret` (manual/curl).
- [x] Convert processed `.zip` back to `.docx` for delivery
  - n8n repacks the processed output as `.docx` and stamps `processed_file_path` + `status = complete` in the `projects` table

---

## Admin Dashboard (Analytics)

- [ ] Internal admin dashboard for the owner
  - A private dashboard for tracking how the app is doing overall — not user-facing. Should surface key metrics at a glance: total and active user count, sign-ups over time, revenue (total and over time, ideally split by service and trial vs paid), number of orders, number of files/projects processed, projects by status, conversion rate (sign-ups → paying), and trial usage. Data sources already exist: the `orders` table (revenue, `amount_brl`, `is_trial`), the `projects` table (file/project counts, statuses, services), and `user_profiles` / Supabase auth (user counts, trial usage); Stripe could be a secondary source for payment reconciliation. No concrete approach decided yet — it could live in this repo behind an admin-only route, or be a completely separate repo/app. Access must be restricted to the owner only (admin role check, not just authentication). To be scoped and discussed later.

---

## Pages & Legal

- [x] Landing page
  - `LandingPage.tsx` with `Hero.tsx`, `Services.tsx`, `Pricing.tsx` sections
- [ ] Landing page redesign (unauthenticated)
  - Full visual overhaul of `LandingPage.tsx` and its sections (`Hero.tsx`, `Services.tsx`, `Pricing.tsx`) targeting non-logged-in visitors; stronger value proposition, social proof, and conversion-focused layout
- [x] Terms of service page
  - `TermsPage.tsx`, route `/terms`
- [x] Privacy policy page
  - `PrivacyPage.tsx` created, registered in `App.tsx` under `ROUTES.privacy`. 10 sections in en/pt-BR/pt-PT, includes LGPD compliance section.
- [x] `TextExtractPage` removed
  - The page was never routed and had no importers. Removed as dead code during the refactor, along with its `ROUTES.textExtract` constant.

---

## Infrastructure & Quality

- [x] i18n — English, Portuguese (BR), Portuguese (PT)
  - `i18next` + `react-i18next`, locale files in `src/locales/`, detection via `localStorage` key `formatexto.lang`
- [ ] Error boundaries (no global React error boundary)
  - React `ErrorBoundary` class component wrapping `<Routes>` in `App.tsx`
- [ ] End-to-end tests
  - Playwright — cover auth flow, full order flow, dashboard
- [ ] Unit tests
  - Vitest — cover `pricing.ts`, `extract.ts`, `pdf-slice.ts`, `docx-slice.ts`
- [ ] Final code refactor
  - Pass over the entire codebase before deploy: remove dead code, consolidate duplicated logic, enforce consistent naming, split any components that grew too large, ensure all strings go through `t()`, and confirm no `any` types or unused vars remain

---

## Design & Branding

- [ ] New branding and color system
  - Define new brand identity: logo, color palette, typography scale. Update `tailwind.config.js` tokens (currently `sand`, `forest`, `ink`, etc.) and propagate changes across all components. Update `DESIGN.md` to reflect the new system.

---

## Next Steps (Prioritised)

- [x] Privacy page
  - `PrivacyPage.tsx` created, route `/privacy` registered. 10 sections in en/pt-BR/pt-PT, includes LGPD compliance section.

- [x] Profile page
  - `ProfilePage.tsx` at `/profile` (protected). Displays avatar (initials), full name, email, join date, trial status. Edit full name and email via `supabase.auth.updateUser()`; email change triggers confirmation email. Password change for email/password users only. Connected-account badge (Google vs email). Danger zone with delete-account modal (calls `POST /api/auth/delete-account` — backend endpoint not yet implemented). `ROUTES.profile = '/profile'` added; avatar in Navbar links to `/profile`.

- [ ] DOCX formatting pipeline
  - Most important feature. Requires dedicated effort. Five-step pipeline: (A) rewrite `styles.xml` per guideline, strip direct overrides, fix margins; (B) detect references section, apply hanging indent + spacing; (C) AI — reformat reference entries to guideline citation format; (D) AI — heading reclassification; (E) repack → upload → stamp DB. Full breakdown in [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md). Steps A, B, D, E are built; C is pending.

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` set but nothing acts on it. Query rows where `delete_files_at < now()` and `files_deleted_at is null`, delete from Supabase Storage, stamp `files_deleted_at`. Options: pg_cron, Supabase Edge Function, or n8n scheduled workflow.

- [ ] Email notification when project is ready
  - `POST /api/notifications/project-ready` on Express backend, called by n8n after stamping `status = complete`. Resend installed + `formatexto.com` domain verified. Endpoint not yet implemented.

- [ ] Landing page redesign
  - Full visual overhaul of `LandingPage.tsx` and sections (`Hero.tsx`, `Services.tsx`, `Pricing.tsx`). Stronger value proposition, social proof, conversion-focused layout.

---

## Pre-Deploy Checklist

- [x] Processed file storage + download button
  - n8n uploads processed file to Storage and stamps `processed_file_path` + `status = complete`. Frontend fetches both signed URLs on load; "Baixar Arquivo Final" (primary) shows only when `status === 'complete'`, "Baixar Arquivo Original" (tertiary) always available.

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` is set (30 days after submission) but nothing acts on it. Before deploying, wire up a scheduled job that: queries `projects` where `delete_files_at < now()` and `files_deleted_at is null`, deletes both `original_file_path` and `processed_file_path` from Supabase Storage, then stamps `files_deleted_at`. Options: pg_cron inside Supabase, a scheduled Supabase Edge Function, or an n8n scheduled workflow.
