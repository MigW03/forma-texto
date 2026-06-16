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
- [x] Automatic lauda count detection (DOCX only — PDF removed as input format)
  - DOCX: `getLaudas(file)` in `web/src/lib/laudas.ts` — unzips the file, walks `w:p | w:tbl | w:sdt` body blocks, accumulates word counts, closes a lauda at 300 words (rounding up to paragraphs). Returns `Lauda[]` with block boundaries + word counts. PDF input and `pdf-slice.ts` have been deleted.
- [x] Project title field
  - Local `useState<string>`, auto-filled from filename, persisted to `sessionStorage`
- [x] Terms of service agreement checkbox
  - Local `useState<boolean>`, gates submit button
- [x] Multi-step session state preserved across pages
  - `sessionStorage` (key `SESSION_KEY`) + `useNavigate` with `location.state`
- [x] Lauda selection (choose which laudas to process)
  - `PageSelectionPage.tsx` rebuilt: three-panel layout — lauda checklist (left), continuous `docx-preview` render with in-flow "Lauda N" dashed-rule dividers (center), service/guideline/summary/references panel (right). Laudas are computed from the rendered DOM blocks (same `computeLaudas` word-boundary algorithm as slicing, so dividers and billing always agree). Selecting/deselecting a lauda dims its blocks in the preview via `.lauda-disabled`. Passes `selectedLaudas: number[]` to checkout.
- [x] URL / link input — Google Docs fetch implemented
  - `GET /api/documents/fetch?url=` in `server/src/routes/documents.ts` extracts the doc ID, hits the Google export endpoint, and returns the `.docx` binary with `X-Filename` header. `GetStartedPage.tsx` fetches it on submit, creates a `File` object, runs page count detection, and navigates to `PageSelectionPage` with the file in state — identical to a manual upload from that point on. Loading state shown while fetching. Dropbox and other providers not yet supported.

---

## Checkout & Payment

- [x] Stripe payment integration (card + PIX)
  - `@stripe/react-stripe-js` `Elements` + `PaymentElement`, `loadStripe()` with `VITE_STRIPE_PUBLISHABLE_KEY`
- [x] Free trial for first order (1 page free, gated by `user_profiles.trial_used_at`)
  - Backend checks `user_profiles.trial_used_at`; returns `isFree: true` or `discountBRL` in payment intent response
- [x] Order summary with per-service pricing
  - `calcPrice()` from `lib/pricing.ts` — R$1/lauda formatting, R$2/lauda proofreading, per-service minimums. Billing unit is now the lauda (~300 words), not the page.
- [x] Trial discount line item in summary
  - `trialDiscountBRL()` from `lib/pricing.ts`, rendered conditionally if `isTrial`
- [x] Project record created in Supabase on payment success
  - `supabase.from('projects').insert(...)` in `handleSuccess()` after Stripe confirms
- [x] Original file uploaded to Supabase Storage on payment success
  - `supabase.storage.from('projects').upload(path, file)`, path: `{userId}/{projectId}/original/{filename}`
- [x] File sliced to selected laudas before upload
  - DOCX only (PDF removed). `sliceDocxByLaudas(file, Set<blockIdx>)` in `web/src/lib/docx-slice.ts` — removes unselected body blocks from the document XML, re-zips. Block indices come from `laudaBlockSet(laudas, selectedIndices)` in `web/src/lib/laudas.ts`. Full-doc uploads skip slicing (all laudas selected).
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
- [x] DOCX correction function (proofreading)
  - Now **server-side as Step P** (moved off n8n). The model never emits XML: it returns the corrected plain text of each changed paragraph (`[{ i, text }]`), and a deterministic char-diff (`server/src/lib/formatting/textDiff.ts`) maps each edit onto the run it falls inside (`runs.ts`), so grammar/spelling/tense/ABNT-citation fixes land without flattening the author's intentional bold/italic/link runs. `stepProofread.ts` batches by chapter (`Heading1` boundary) and skips the title, references (auto-detected), tables and captions; `ai/proofreadDecider.ts` + `prompts/proofreading.md` are the model seam. Wired into `processFormatting.ts` after the formatting passes behind `AI_PROOFREADING_ENABLED`; `CheckoutPage` triggers it via `POST /api/processing/start`. 29 unit tests + a gated live eval that passed on the free model. Live-confirm on one real multi-page upload still pending.
- [ ] DOCX formatting function — see [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md) for full breakdown
  - Five-step pipeline: (A) deterministic — rewrite `styles.xml` per guideline, strip direct overrides, fix margins; (B) deterministic — detect references section, apply hanging indent + spacing; (C) AI — reformat reference entries to guideline citation format (Haiku/GPT-4o-mini); (D) AI — heading reclassification; (E) repack → upload → stamp DB. AI only touches semantics; layout is deterministic XML.
  - **Progress (migrating off n8n → server, per `business_decisions/n8n-vs-server.md`):** Steps A & B implemented server-side in `server/src/lib/formatting/` (pure transforms: `rewriteStyles`, `stripDirectOverrides`, `rewriteMargins` in `applyStepA`; `formatReferences` for Step B; zip via `docxZip`) + orchestrator `server/src/lib/processFormatting.ts` (download → Step A → Step B → re-zip → upload `processed/` → stamp `status='complete'` → ready email). Triggered by `POST /api/processing/start` (`x-webhook-secret`, in-process async, 202). 33 unit + real-fixture tests pass (vitest). Canonical guideline spec: `server/src/lib/formatting/specs/abnt.md` — now the **live single source of truth**: `getGuideline()` reads the spec's machine block at runtime (`loadGuideline.ts`, parsed with JSON5 + validated with zod, cached by file mtime so edits apply with no rebuild or restart), falling back to a built-in table in `guidelines.ts` only if a spec is missing or invalid. The spec also carries the `display` metadata that drives the guideline dropdown (see Onboarding). A copy step (`scripts/copySpecs.js`) ships the `.md` specs into `dist` for production builds.
  - **Architecture decision — references no longer split:** since processing left n8n, the separate references file is unnecessary. The plan is to store ONE file (selected pages incl. references); Step B detects the references section by heading text and `references_file_path` has been removed (the separate references file is gone). Step B is **bounded to the user-flagged `references_pages`** (not word-detection — "Referências" can appear in body text); flagged pages are mapped to paragraphs via pagination signals (manual page breaks / `sectPr` / `lastRenderedPageBreak` / 40-block fallback). Step C (AI reference reformatting) is confirmed in-scope for later. The ABNT heading-font reconcile is **done** — body and headings now derive from a single `fonts.default`, enforcing one font per document (Arial and Times New Roman are both ABNT-valid, but never mixed); the `abnt.md` spec was clarified accordingly. **Step D (AI heading reclassification) is done** — built server-side via OpenRouter (OpenAI-compatible) + Vercel AI SDK (`generateObject` + zod), model-agnostic behind the `HeadingDecider` seam (`stepD.ts`, `ai/headingDecider.ts`, `ai/config.ts`, `ai/headingsPrompt.ts`). Shared block parser extracted to `blocks.ts`; `locateReferences` exported from `references.ts`; spec §4 drives the prompt via `loadGuidelineDoc`/`guidelineSection`. Wired into `processFormatting` behind the `AI_FORMATTING_ENABLED` flag with graceful fallback (an AI failure keeps the deterministic A/B result). 17 new offline unit tests (fake decider, no network) + a gated live eval (`RUN_AI_EVALS=1`) that passed against `openai/gpt-oss-120b:free` (promoted 2 plain-text headings, 0 blocks lost). Per-level heading caps/bold in Step A is **done** — `rewriteStyles` builds Heading1/2/3 from the spec's `headings.levels` (H1 caps+bold, H2 caps, H3 sentence+bold; one size, ABNT differentiates by case+bold not size). Step D also logs each identified heading (tier + page) to the server console. **Step C (AI reference reformatting) is done** — same model-agnostic pattern as Step D, behind the `ReferenceDecider` seam (`stepC.ts`, `ai/referencesDecider.ts`, `ai/referencesPrompt.ts`, `prompts/reference-reformatting.md`). It chunks the located references region's entries (each independent, no cross-chunk context), the model returns `[{ i, segments: [{ text, emphasis? }] }]`, and deterministic code renders the segments into `<w:r>` runs (bold/italic) and splices over each entry by absolute index, keeping Step B's `<w:pPr>`; an entry with no usable segments is left unchanged. The decider reads spec §6 (rules) + §7 (examples) and reuses `headingDecider`'s `repairDecisions`. Wired into `processFormatting` (A → B → C → D) behind `AI_FORMATTING_ENABLED`, each AI pass independently try/caught. 14 new offline unit tests (fake decider) + a gated live eval (`stepC.eval.test.ts`); server suite now 77 passing. **Live confirmation still pending** (the eval's fixture page flags need pointing at a real references page). **Still pending:** confirm Step C live + promote off the free model; unnumbered-title style (RESUMO/SUMÁRIO) in Step A; migrate proofreading off n8n.
  - **First-H1 page break (2026-06-14):** `Heading1`'s style carries `<w:pageBreakBefore/>` (every H1 starts a new page), but the **first** H1 must not — it would isolate a lone title or add a blank page after an already-paginated cover. New `pageBreaks.ts` (`suppressFirstHeadingPageBreak`) injects a direct `<w:pageBreakBefore w:val="false"/>` on the first `Heading1` paragraph (overrides the style for it alone). Runs after the AI passes in `processFormatting` (the first H1 may be one Step D promoted). 4 unit tests; spec §4/§9 updated.
  - **List indentation (2026-06-14):** Word's per-level default (720 twips ≈ 1.27 cm) makes deeply-nested items very wide. New `normalizeNumbering.ts` → `normalizeNumberingXml` rewrites every `<w:lvl>` in `word/numbering.xml` to step = 480 twips (≈ 0.85 cm), hanging = 240, applied right after `unzipDocx` before Step A. 5 unit tests. Tune with `STEP` constant.
  - **Image captions (2026-06-14):** added a deterministic, label-anchored caption pass. Around each image (`<w:drawing>`/`<w:pict>`/`<w:object>`) the paragraph **before** is styled `Caption` only when it opens with a figure label (`Figura 1 —`, `Imagem 2 -`, `Gráfico 3:`) and the paragraph **after** only when it opens with a source label (`Fonte:`) — so body text wrapping an inline image is never shrunk. `Caption` = centered, 10pt, single. New `Caption` style in `rewriteStyles`, values from `GuidelineSpec.caption` (parsed from the spec's §8 `caption` block); pass in `captions.ts` (`formatCaptions`) swaps only the matched neighbor's `<w:pStyle>` by absolute index and runs last in `processFormatting` so an AI heading promotion can never override it. Documented in `abnt.md` §11. 8 caption tests + a style test; suite 94 passing. Live confirmation pending (no image in the test fixture yet).
  - **Step D robustness (2026-06-13):** two output bugs from a real run were fixed. (1) The pass was promoting numbered **list items** to headings — they read identically to numbered headings by text alone, and promoting one breaks the list's numbering (all items restart at "1"). Now list items are detected via `isListItem()` (`<w:numPr>`) in `blocks.ts`, excluded as heading candidates in `chunkHeadings`, refused in `applyHeadingDecisions` even on an explicit decision, and called out in the prompt. (2) A sibling among several identical headings was jumping a level because the `atPageStart` cue was weighted as a "strong h1 sign"; the prompt now treats it as a weak signal and adds a "treat parallel headings identically" rule. 2 new regression tests; formatting suite green.
  - **Done:** frontend stores one file (references inline; the `references_file_path` column has been removed); `ProjectDetailPage` viewer handles the single file. **Trigger cutover done for both services** — `CheckoutPage` calls `POST /api/processing/start` (Bearer = project owner's Supabase token) after the row is created whenever formatting **or** proofreading is requested; the old n8n `/notify` path for proofreading-only is gone. The `/processing/start` route accepts the owner's Bearer token OR the `x-webhook-secret` (manual/curl).
- [x] Convert processed `.zip` back to `.docx` for delivery
  - n8n repacks the processed output as `.docx` and stamps `processed_file_path` + `status = complete` in the `projects` table

---

## Interactive Content Completion (missing captions & sources)

> **Goal.** Many uploads are missing required ABNT elements — a figure/table caption or its source line. Rather than guess these with AI, the pipeline detects what is missing, inserts a pre-formatted **red placeholder** in the right spot, and hands the document back to the user to fill in. The user types the missing text in the processed-file view; a deterministic, near-instant edit drops their text into place (in the final black formatting) and promotes the project to its finished state. **No additional AI runs in this step.**
>
> **Decisions captured (2026-06-14):** (a) "font" in the request means the **source line** ("Fonte: …"), not the typeface. (b) All four slots are in scope: figure caption, figure source, table caption, table source. (c) ABNT policy is **always require both** a caption and a source for every image and every table; any absent one becomes a placeholder. (d) The fill-in edit happens **server-side** via a new endpoint (the stored processed `.docx` stays the single source of truth and reuses the existing `blocks.ts` machinery). Builds directly on the deterministic caption pass (`captions.ts`, see `abnt.md` §11).

- [ ] **Detection pass — find missing caption/source slots**
  - New deterministic step in the pipeline (after `formatCaptions`), reusing the image (`<w:drawing>`/`<w:pict>`/`<w:object>`) and `<w:tbl>` detection plus `FIGURE_LABEL_RE` / `SOURCE_LABEL_RE`. For each image and each table, check whether a labelled caption precedes it and a labelled source follows it. Each absent slot produces a descriptor: `{ id, kind: 'figure-caption' | 'figure-source' | 'table-caption' | 'table-source', ordinal, anchorBlockIndex }`. `id` is stable and unique (e.g. `fig.1.caption`).

- [ ] **Placeholder insertion — pre-formatted, red, machine-locatable**
  - For each missing slot, insert a placeholder paragraph at the correct position (caption before the anchor, source after it), already in the `Caption` style and with a single red run (`<w:color w:val="FF0000"/>`) holding a sentinel marker the final edit can find exactly (recommended: a unique token such as `{{FT:fig.1.caption}}`, or a `<w:sdt>` content control tagged with `id`). The placeholder's *visible* prompt text (e.g. "Figura 1 — [inserir legenda]" / "Fonte: [inserir fonte]") is localized and shown to the user; the marker is what the server matches on.

- [ ] **New project status `needs_input`**
  - Extend the status flow to `pending → processing → needs_input → complete`. `needs_input` means: formatting + AI passes are done and the processed file is viewable, but required content is still missing, so the final download is **not** unlocked. Add the value to the `projects.status` CHECK/enum and update `supabase_tables.md`. The dashboard and project-detail status badges get a new state (amber, "Needs your input" / "Aguardando preenchimento").

- [ ] **Persist the pending slots — `projects.pending_inputs` (jsonb)**
  - New nullable column storing the detection descriptors: `[{ id, kind, ordinal, label, placeholder }]`. Written by the pipeline when it stamps `needs_input`; cleared to `null` when the project reaches `complete`. Drives the frontend form (no need to parse the docx in the browser). Document in `supabase_tables.md`.

- [ ] **Pipeline wiring — stamp `needs_input` vs `complete`**
  - In `processFormatting`, after detection + placeholder insertion, set `status = needs_input` and write `pending_inputs` when any slot is missing; otherwise keep the current `complete` path. The "project ready" email should only fire on `complete` (consider a separate "needs your input" email later).

- [ ] **Fill-in endpoint — `POST /api/processing/fill-content`**
  - Auth: project owner Bearer token (mirrors `/processing/start`). Body: `{ projectId, fills: { [id]: text } }`. Server downloads the processed `.docx`, replaces each placeholder marker with the user's text **and** removes the red color (final black/auto formatting, `Caption` style retained), re-zips, re-uploads to `processed_file_path`, clears `pending_inputs`, stamps `status = complete` + `completed_at`, and sends the ready email. Pure string/`replaceBlocks` edit — no AI. Validate that every `id` in `fills` exists in `pending_inputs` and reject unknown ids.

- [ ] **Frontend — fill-in UI in the processed-file view**
  - In `ProjectDetailPage`, when `status === 'needs_input'`: show the processed document (with the red placeholders visible in the viewer) plus a side panel listing one labelled text input per `pending_inputs` entry. Submitting calls the fill endpoint; on success the status flips to `complete`, the placeholders are gone, and the "Baixar Arquivo Final" button unlocks. Inputs are required before submit is enabled. All strings via `t()` in the three locales; add the new status badge styling.

- [ ] **Tests**
  - Server: detection unit tests (image/table with/without caption/source → correct slot descriptors); placeholder insertion (correct position, `Caption` style, red run, locatable marker); fill endpoint (marker replaced, red stripped, unknown id rejected, status → complete, `pending_inputs` cleared). Web: render the fill form from `pending_inputs`, submit, assert the success transition.

---

## Word-Choice Suggestions (optional proofreading improvements)

> **Goal.** Step P already auto-applies clear grammatical corrections. But proofreading also surfaces words that are not *wrong*, only *weaker* than an available alternative — e.g. the author wrote "titulado" where "intitulado" reads better. We must never silently swap these (it would change the author's wording on a judgement call), so instead the pipeline **flags** them and lets the user **choose**: keep the original or accept a suggested alternative. Once the user has reviewed, a deterministic edit drops the accepted words in and produces the final file. **No extra AI run happens at selection time** — the suggestions are computed once, during Step P.
>
> This is a sibling of the *Interactive Content Completion* flow above: same `needs_input` gate, same "AI proposes / user decides / deterministic apply" shape, and it reuses the Step P run-splice core (`runs.ts` / `textDiff.ts`) so accepted swaps preserve the paragraph's run formatting exactly.

- [ ] **Detection — identify optional word-choice improvements in Step P**
  - Extend the proofreading model output with a SECOND, separate channel alongside the auto-applied corrections: a list of *suggestions*, each `{ i, original, replacement, reason? }` where `original` is the exact span as it appears in the (already grammar-corrected) paragraph and `replacement` is the better word/phrase. Keep this strictly for **style/word-choice** improvements that are NOT errors — anything clearly wrong stays in the auto-correction path. Prefer returning both channels from the **same model call** (no extra spend); update `proofreading.md` and the decider's zod schema accordingly. Each suggestion must be locatable: resolve `original` to a block index + char range via the existing `paragraphText`/run-offset mapping, and drop any suggestion whose span can't be uniquely/cleanly located (conservative, like the apply core).

- [ ] **Persist the pending suggestions — `projects.pending_suggestions` (jsonb)**
  - New nullable column storing the resolved descriptors: `[{ id, i, original, replacement, reason?, context }]` (`context` = a short snippet around the span for display; `id` stable + unique). Written by the pipeline when Step P finishes if any suggestions exist; cleared to `null` once the user submits their choices. Document in `supabase_tables.md`. (Decide whether to reuse the captions feature's `needs_input` status + a combined review step, or keep word-choice review as its own state — coordinate with that feature so a project that needs BOTH caption input AND word-choice review is handled in one pass.)

- [ ] **Pipeline wiring — stamp the review state**
  - In `processFormatting.ts`, after Step P, if suggestions exist set the project to the review state (`needs_input`) and write `pending_suggestions`; otherwise keep the normal `complete` path. The "project ready" email only fires on `complete`. The auto-applied corrections are already in the processed file the user reviews; suggestions are shown as *optional* overlays on top.

- [ ] **Apply endpoint — `POST /api/processing/apply-suggestions`**
  - Auth: project owner Bearer token (mirrors `/processing/start`). Body: `{ projectId, accepted: id[] }` (ids the user chose to apply; unlisted = keep original). Server downloads the processed `.docx`, applies each accepted suggestion with `spliceCorrectedText` (so run formatting is preserved and a span that no longer matches is skipped), re-zips, re-uploads to `processed_file_path`, clears `pending_suggestions`, stamps `status = complete` + `completed_at`, sends the ready email. Pure deterministic edit — no AI. Reject unknown ids.

- [ ] **Frontend — suggestion review UI in the processed-file view**
  - In `ProjectDetailPage`, when the project is in the review state: show the processed document plus a side panel listing each `pending_suggestions` entry as `original → replacement` with its context snippet and optional reason, each with accept / keep-original toggles (default = keep original, since these are optional). Submitting calls the apply endpoint; on success the status flips to `complete` and "Baixar Arquivo Final" unlocks. All strings via `t()` in the three locales; add the review-state badge styling. Coordinate the panel with the captions fill-in panel so both can be presented together when a project needs both.

- [ ] **Tests**
  - Server: detection returns suggestions only for word-choice (not for errors, which stay auto-applied); span resolution + skip-on-ambiguous; apply endpoint (accepted ids swapped via `spliceCorrectedText`, formatting preserved, unknown id rejected, unaccepted left as original, status → complete, `pending_suggestions` cleared). Web: render the review panel from `pending_suggestions`, accept a subset, assert the success transition.

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
  - Vitest — cover `pricing.ts`, `docx-slice.ts`, `laudas.ts` (`pdf-slice.ts` deleted)
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
