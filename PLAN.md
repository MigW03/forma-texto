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

- [ ] Email notification when project is ready
  - Supabase Edge Function triggered by DB status change, sends email via Resend or SendGrid
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
- [ ] DOCX formatting function — see `formattingPlan.md` for full breakdown
  - Five-step pipeline: (A) deterministic — rewrite `styles.xml` per guideline, strip direct overrides, fix margins; (B) deterministic — detect references section, apply hanging indent + spacing; (C) AI — reformat reference entries to guideline citation format (Haiku/GPT-4o-mini); (D) AI — heading reclassification; (E) repack → upload → stamp DB. AI only touches semantics; layout is deterministic XML.
- [x] Convert processed `.zip` back to `.docx` for delivery
  - n8n repacks the processed output as `.docx` and stamps `processed_file_path` + `status = complete` in the `projects` table

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

## Next Steps (Prioritised)

- [x] Privacy page
  - `PrivacyPage.tsx` created, route `/privacy` registered. 10 sections in en/pt-BR/pt-PT, includes LGPD compliance section.

- [ ] Profile page
  - New page at `/profile`, protected route. Link from navbar user menu (currently shows initials avatar button).
  - **Display:** full name, email address, avatar (initials fallback if no photo), account creation date, trial status (used or available).
  - **Edit full name:** inline text input + save button → `supabase.auth.updateUser({ data: { full_name } })`.
  - **Edit email:** input + confirm button → `supabase.auth.updateUser({ email })` — triggers confirmation email to new address; show instructional notice to user.
  - **Change password:** only shown for email/password accounts (not Google OAuth users) — current password + new password fields → `supabase.auth.updateUser({ password })`.
  - **Connected accounts:** read-only badge showing auth provider (Google or email). Google users cannot set a password.
  - **Danger zone:** "Delete account" button — requires confirmation modal — calls Supabase admin API or Edge Function (client SDK cannot self-delete); on success, sign out and redirect to `/`.
  - **Add `ROUTES.profile = '/profile'`** to `routes.ts` and register in `App.tsx`.

- [ ] DOCX formatting pipeline
  - Most important feature. Requires dedicated effort. Five-step pipeline: (A) rewrite `styles.xml` per guideline, strip direct overrides, fix margins; (B) detect references section, apply hanging indent + spacing; (C) AI — reformat reference entries to guideline citation format; (D) AI — heading reclassification; (E) repack → upload → stamp DB. Full breakdown in `formattingPlan.md`.

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` set but nothing acts on it. Query rows where `delete_files_at < now()` and `files_deleted_at is null`, delete from Supabase Storage, stamp `files_deleted_at`. Options: pg_cron, Supabase Edge Function, or n8n scheduled workflow.

- [ ] Email notification when project is ready
  - Supabase Edge Function triggered by DB status change to `complete`. Send via Resend or SendGrid.

- [ ] Landing page redesign
  - Full visual overhaul of `LandingPage.tsx` and sections (`Hero.tsx`, `Services.tsx`, `Pricing.tsx`). Stronger value proposition, social proof, conversion-focused layout.

---

## Pre-Deploy Checklist

- [x] Processed file storage + download button
  - n8n uploads processed file to Storage and stamps `processed_file_path` + `status = complete`. Frontend fetches both signed URLs on load; "Baixar Arquivo Final" (primary) shows only when `status === 'complete'`, "Baixar Arquivo Original" (tertiary) always available.

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` is set (30 days after submission) but nothing acts on it. Before deploying, wire up a scheduled job that: queries `projects` where `delete_files_at < now()` and `files_deleted_at is null`, deletes both `original_file_path` and `processed_file_path` from Supabase Storage, then stamps `files_deleted_at`. Options: pg_cron inside Supabase, a scheduled Supabase Edge Function, or an n8n scheduled workflow.
