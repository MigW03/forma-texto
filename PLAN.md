# FormaTexto — Feature Plan

---

## Next Actions

- [ ] Normalize binary item index in n8n for URL-sourced files
  - When a file is uploaded directly, the n8n workflow finds the DOCX content at `file_3` in the uncompressed binary items. When the file comes from a Google Docs link (fetched via `/api/documents/fetch` and uploaded as `.zip`), the relevant binary item is at `file_5` (observed in at least one test case). Investigate why the index differs — likely a structural difference in the ZIP produced by Google's export vs. a user-uploaded DOCX — and update the n8n filter to handle both cases, either by detecting the correct item dynamically or by normalizing the upload so both paths produce the same ZIP structure.

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
- [ ] Profile details page
  - New page at `/profile` — display and edit full name, email, and avatar; use `supabase.auth.updateUser()` for email/name changes; link from navbar user menu
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
- [ ] Always display cents in price values
  - `formatBRL()` in `lib/pricing.ts` must always show two decimal places (e.g. R$&nbsp;1,00 not R$&nbsp;1). Audit every place a price is rendered — checkout summary, trial discount line, order total, pricing cards in `GetStartedPage.tsx`, and `Pricing.tsx` on the landing page — and ensure all use `formatBRL()` consistently with cents visible.

- [ ] PIX payment support
  - Add `payment_method_types: ['card', 'pix']` to the `stripe.paymentIntents.create()` call in `server/src/routes/checkout.ts` so Stripe activates PIX on the intent. On the frontend, `PaymentElement` already lists PIX in `paymentMethodOrder` — confirm it renders correctly. PIX is async: the user scans a QR code and Stripe redirects back with `redirect_status`; `CheckoutPage.tsx` already handles `redirect_status` in the URL, but verify the `payment_intent.succeeded` webhook fires and the order is recorded correctly for PIX-originated payments.
- [ ] Comprehensive free trial security test
  - Verify the trial cannot be abused: test that a user who selects multiple pages cannot receive the free trial (backend must reject `pageCount > 1` on `complete-free-order`); test that a user cannot trigger a second free trial after the first is consumed (`trial_used_at` is stamped and re-checked server-side on every request); test that manipulating the client-side `isFree` or `isTrial` flags in the request body has no effect since eligibility is always re-verified in `checkout.ts`; test that creating a new account to bypass `trial_used_at` does not give a second trial if the same payment method or identity is reused.

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
- [ ] Download processed file button
  - The existing download button in `ProjectDetailPage.tsx` was built for the original file but should have targeted the processed output from the start. Wire it to `project.processed_file_path` using `supabase.storage.from('projects').createSignedUrl(path, 3600)`, visible only when `status === 'ready' || status === 'delivered'`.
  - Explore a two-button approach: one for the processed file (primary CTA) and one for the original upload (secondary), so users can always retrieve what they sent in regardless of project status.
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
- [ ] PDF formatting function
  - Read uploaded PDF, apply academic formatting rules (margins, fonts, heading hierarchy, spacing) according to selected guideline (ABNT, APA, etc.), write formatted PDF back to Storage
- [ ] PDF correction — apply corrected text to existing PDF
  - After proofreading pass produces corrected text, edit the original PDF to replace content in-place; preserve layout, fonts, and structure as much as possible
- [ ] DOCX correction function
  - Read `.zip` (stored DOCX), apply grammatical corrections to the XML content (`word/document.xml`), repack as `.zip` and write back to Storage
- [ ] DOCX formatting function
  - Parse `word/document.xml` styles and apply guideline-compliant formatting (paragraph styles, heading levels, page margins via `word/settings.xml` and `word/styles.xml`)
- [ ] Convert processed `.zip` back to `.docx` for delivery
  - Rename the output `.zip` to `.docx` and update `processed_file_path` before marking project as `ready`; ensure MIME type is set correctly for download

---

## Pages & Legal

- [x] Landing page
  - `LandingPage.tsx` with `Hero.tsx`, `Services.tsx`, `Pricing.tsx` sections
- [ ] Landing page redesign (unauthenticated)
  - Full visual overhaul of `LandingPage.tsx` and its sections (`Hero.tsx`, `Services.tsx`, `Pricing.tsx`) targeting non-logged-in visitors; stronger value proposition, social proof, and conversion-focused layout
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
- [ ] Final code refactor
  - Pass over the entire codebase before deploy: remove dead code, consolidate duplicated logic, enforce consistent naming, split any components that grew too large, ensure all strings go through `t()`, and confirm no `any` types or unused vars remain

---

## Design & Branding

- [ ] New branding and color system
  - Define new brand identity: logo, color palette, typography scale. Update `tailwind.config.js` tokens (currently `sand`, `forest`, `ink`, etc.) and propagate changes across all components. Update `DESIGN.md` to reflect the new system.

---

## Pre-Deploy Checklist

- [ ] Processed file storage + download button
  - Backend AI pipeline must upload the processed file to Supabase Storage at `{userId}/{projectId}/processed/{filename}` and update `projects.processed_file_path`. Frontend side: `ProjectDetailPage.tsx` already has a download button for the original file using a signed URL — replicate the same pattern for `processed_file_path` and show it only when `status === 'ready' || status === 'delivered'`. Both the backend write and the frontend button must be done together for the feature to work end-to-end.

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` is set (30 days after submission) but nothing acts on it. Before deploying, wire up a scheduled job that: queries `projects` where `delete_files_at < now()` and `files_deleted_at is null`, deletes both `original_file_path` and `processed_file_path` from Supabase Storage, then stamps `files_deleted_at`. Options: pg_cron inside Supabase, a scheduled Supabase Edge Function, or an n8n scheduled workflow.
