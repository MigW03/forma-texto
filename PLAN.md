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
- [ ] Account / profile settings page
  - New page + `supabase.auth.updateUser()` for email/name changes
- [ ] Delete account
  - Supabase admin API or Edge Function — requires server-side call

---

## Onboarding Flow

- [x] Service selection (proofreading, formatting)
  - Local `useState<Set<ServiceType>>` in `GetStartedPage.tsx`
- [x] Academic guideline selection (ABNT, APA, MLA, Chicago)
  - Local `useState<GuidelineId>`, shown conditionally when formatting selected
- [x] File upload (.pdf, .docx) with drag-and-drop
  - Native HTML drag events + `<input type="file">`, stored in `file-store.ts` module closure
- [x] File type validation (.doc warning, invalid type error)
  - Extension + MIME type check in `GetStartedPage.tsx`
- [x] Automatic page count detection (PDF + DOCX)
  - PDF: regex on raw bytes (`/Count`). DOCX: `fflate` unzip → parse `docProps/app.xml`, fallback to `docx-preview` render measurement
- [x] Project title field
  - Local `useState<string>`, auto-filled from filename, persisted to `sessionStorage`
- [x] Terms of service agreement checkbox
  - Local `useState<boolean>`, gates submit button
- [x] Multi-step session state preserved across pages
  - `sessionStorage` (key `SESSION_KEY`) + `useNavigate` with `location.state`
- [x] Page selection (choose which pages to process)
  - `PageSelectionPage.tsx` — renders doc preview, user picks pages, passes `selectedPages: number[]` to checkout
- [ ] URL / link input actually fetches document — UI exists but not wired (Google Docs, Dropbox, etc.)
  - Backend endpoint needed to fetch + convert remote URL to file; frontend passes `pasteUrl` in state

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
- [ ] Remove boleto from Stripe `paymentMethodOrder` (currently still in code)
  - `CheckoutPage.tsx` line 109 — remove `'boleto'` from array

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
- [ ] Real-time / polling status updates (currently requires page refresh)
  - Supabase Realtime: `supabase.channel(...).on('postgres_changes', ...)` subscription on `projects` table

---

## Project Detail

- [x] PDF viewer with zoom controls and lazy page rendering
  - `pdfjs-dist` with `IntersectionObserver` for lazy render, `ResizeObserver` for responsive width, DPR-aware canvas
- [x] PDF text layer (selectable text)
  - `pdfjsLib.TextLayer`, styled via `.pdf-text-layer` CSS in `index.css`
- [x] DOCX viewer with zoom controls
  - `docx-preview` `renderAsync()`, custom CSS injected for page separators and numbering
- [x] Project metadata panel (service, guideline, page count, cost, date)
  - Right-side panel, reads from `supabase.from('projects').select(...).eq('id', id).single()`
- [x] Download original file
  - `supabase.storage.from('projects').createSignedUrl(path, 3600)`, rendered as `<a download>`
- [ ] Download processed / output file (UI missing — `processed_file_path` exists in DB but unused)
  - Same signed URL pattern as original file, but from `project.processed_file_path`; add download button when `status === 'ready' || 'delivered'`
- [ ] Real-time status updates (no polling or Supabase Realtime subscription)
  - Supabase Realtime subscription on the specific project row; update local state on `status` change
- [ ] Show processing progress or estimated time
  - UI-only: status-based messaging, or backend-driven `progress` field added to `projects` table

---

## Notifications

- [ ] Email notification when project is ready
  - Supabase Edge Function triggered by DB status change, sends email via Resend or SendGrid
- [ ] In-app notification or badge for status change
  - Supabase Realtime on `projects` table, show toast or navbar badge

---

## Backend / AI Pipeline

- [ ] AI processing pipeline (receives uploaded file, runs formatting/proofreading)
  - Backend reads file from Supabase Storage, runs multi-model AI chain, writes output file back
- [ ] Project status updates written back to DB (`pending` → `processing` → `ready`)
  - Backend calls `supabase.from('projects').update({ status })` at each stage
- [ ] Processed file written to `processed_file_path` in Supabase Storage
  - Backend uploads to `{userId}/{projectId}/processed/{filename}`, updates `projects.processed_file_path`
- [ ] Webhook or job queue to trigger processing after order created
  - Options: Supabase DB webhook → backend endpoint, or a job queue (BullMQ, etc.) triggered on project insert

---

## Pages & Legal

- [x] Landing page
  - `LandingPage.tsx` with `Hero.tsx`, `Services.tsx`, `Pricing.tsx` sections
- [x] Terms of service page
  - `TermsPage.tsx`, route `/terms`
- [ ] Privacy policy page (route `/privacy` defined, page file missing)
  - Create `PrivacyPage.tsx`, register in `App.tsx` under `ROUTES.privacy`
- [ ] `TextExtractPage` route (page file exists, no route registered)
  - Add `<Route path={ROUTES.textExtract} element={<TextExtractPage />} />` in `App.tsx`

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
