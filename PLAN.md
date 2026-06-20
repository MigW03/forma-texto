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
- [ ] Re-add document zoom controls to the lauda selection page (`PageSelectionPage.tsx`) — reuse the `ZoomControls` component from the project detail viewer.

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
  - Checkbox "Este documento possui uma seção de referências" (checked by default) + page range input in the right panel of `PageSelectionPage.tsx`. On checkout success: slices reference pages from the original file (PDF via `slicePdf`, DOCX via `sliceDocx`), uploads to `{userId}/{projectId}/original/references/`, stamps `references_pages` (int4[]) and `references_file_path` (text) on the project row at insert. Both columns added to `projects` table in `supabase_tables.md`. Final download merge (body + references) pending. **Gating (2026-06-16):** the references card is formatting-only — `showReferences = activeServices.has('formatting')` hides it for proofreading-only orders (it no longer blocks Continue, and `formatReferences` is sent only when formatting is selected); Step P auto-detects + skips references server-side either way.
- [x] Download processed file button
  - Two-button layout in the details panel: primary "Baixar Arquivo Final" downloads `processed_file_path` via signed URL — visible only when `project.status === 'complete'`; tertiary "Baixar Arquivo Original" downloads the original file and appears below it. Both signed URLs fetched in parallel on load. Tertiary variant added to `Button` component (`text-muted hover:text-ink hover:bg-sand`, no border).
- [x] Download final file as PDF (second button) (2026-06-16)
  - The pipeline now exports a PDF alongside the processed `.docx`. New `server/src/lib/docxToPdf.ts` shells out to a headless LibreOffice (`soffice --headless --convert-to pdf`, private per-call `UserInstallation` profile so parallel jobs don't clash) for true Word fidelity (ABNT margins/fonts/pagination, which an HTML export can't match). `processFormatting` step 6b converts `docxBuf` and uploads it to the same `processed/` path with a `.pdf` extension — **non-fatal**: a missing/broken LibreOffice logs and is skipped, the `.docx` still ships. Needs LibreOffice on the host; `SOFFICE_PATH` env points at the binary (documented in `.env.example`, default `soffice`). Frontend: `ProjectDetailPage` derives the pdf path via `pdfPathFor()` (swap `.docx`→`.pdf`), signs it in both the initial load and the realtime-complete handler, and renders a second primary "Baixar PDF Final" button **only when the signed URL resolves** (absent for older projects or when conversion was skipped). New i18n key `project.downloadFinalPdf` in all three locales. No DB column — the PDF is found by path convention. **Pending live confirm:** LibreOffice not yet installed on the dev machine, so the export path is untested end-to-end (typechecks pass, conversion is no-op until `soffice` is present).
- [x] Viewer top bar with unified controls
  - Shared absolute top bar over the file viewer: white-pill back button, inline plain-text file version label ("Visualizando arquivo final/original", green when processed), spacer, zoom controls (right). Sand gradient fades downward behind the bar. Gradient extends `right-0 md:right-80` to avoid hard cutoff on mobile. Zoom state lifted to `ProjectDetailPage` and passed as prop to both `PdfViewer` and `DocxViewer`; `ZoomControls` extracted as a standalone component. Status badge remains in the details panel.
- [x] Processed file shown in viewer
  - `previewUrl` prefers `processedFileUrl` when `status === 'complete'`, falls back to original. Viewer re-renders automatically when processed file is available.
- [x] Viewer loading feedback (anti-"frozen")
  - docx-preview's `renderAsync` builds the whole document DOM synchronously and blocks the main thread (no streaming/worker mode), so on larger docs the preview looked frozen — even the skeleton's pulse animation stalled mid-render. `DocxViewer` now (1) yields a double `requestAnimationFrame` after `fetch → blob` and before `renderAsync` so the browser paints the loading state before the freeze, and (2) shows a centered `Loader2` spinner + `project.loadingPreview` / `project.loadingPreviewHint` message instead of bare pulsing rectangles. The render itself can't be sped up without virtualization/worker rewrite (deferred). Two i18n keys added to all 3 locales.
  - **Load-latency probe (temporary):** even the *loading indication* was slow to appear, pointing at the Supabase round-trips that gate the viewer mount — two sequential hops (`.single()` DB query, then `createSignedUrl` ×3) before `fetch(url)` downloads the file and `renderAsync` runs. Added temporary `console.log` timing (`[ProjectDetail timing]` DB query / signed URLs / total; `[DocxViewer timing]` file download +KB / renderAsync). **Remove once region is confirmed/fixed.**
  - **Diagnosis (live, 1.2 MB doc):** DB query ~320–580ms · signed URLs ~1.1–1.6s · download ~3.4–4.0s · renderAsync **50ms**. Render is not the bottleneck — it's all Supabase network. A 1.5s signed-URL call (tiny operation) = region latency. **Primary fix is infra: confirm Supabase region is `sa-east-1` (São Paulo); migrate if it's us-east/eu.** Only that speeds the first load.
  - **CDN caching fix (shipped):** the processed `.docx` was uploaded with `cacheControl: '0'` (no CDN caching → every view a full origin fetch). Changed both upload sites (`processFormatting.ts`, finalize in `processing.ts`) to `cacheControl: '3600'` and reworked `bustCache(url, version)` to key on the project's `completed_at` (stable per content version) instead of `Date.now()`. Same version → CDN hit (fast repeat loads); finalize/reprocess bumps `completed_at` → fresh fetch (no staleness). `completed_at` added to the query + `ProjectDetail` + realtime merge. Only affects files uploaded after this change — reprocess to test. Restart the server.
- [x] Real-time status updates on project detail page
  - Realtime subscription updates `project.status` live (badge + processed file URL re-sign). The `needs_input → complete` finalize transition does a full `window.location.reload()` so the updated file always shows.
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

- [x] AI processing pipeline (receives uploaded file, runs formatting/proofreading)
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
  - **Connection-reset resilience (2026-06-16):** a real full-flow run hit `ECONNRESET` / "terminated" mid-response from the free model — the request returned `200` then the socket dropped while reading the body, which the AI SDK marks `isRetryable: false`, so its own `maxRetries` never fired and the whole Step P chunk was lost (non-fatal, prior result kept). Fix: new `ai/retry.ts` (`withConnectionRetry` + `isConnectionResetError`) walks the error's `cause` chain and retries **only** transport-level resets with exponential backoff + jitter, leaving HTTP-status retries (429/5xx) to the SDK. Wrapped around the `generateObject` call in all three deciders (`proofreadDecider`, `headingDecider`, `referencesDecider`); retry count reuses `AI_MAX_RETRIES`. Also gave Step P its own smaller output budget — `AI_PROOFREAD_MAX_TOKENS` (default 4096, separate from Step C/D's `AI_MAX_TOKENS`) so shorter generations finish faster and reset less, without starving the heading/reference passes. 8 new unit tests (`retry.test.ts`); server suite now 140 passing.
  - **Step C reference batching (2026-06-16):** Step C reformatted only a few of N references and the count varied run-to-run (10 sent → 2, then 6, then with nano just 1; all `finishReason=stop`, ~8k output tokens — i.e. not truncation/routing). Cause: references are short, so the char budget packed **all** entries into a single model call, and a reasoning model handed the whole batch over-reasons and silently drops most. Fix: `chunkReferences` now also caps **entries per chunk** (`maxEntries`, default 3, via `AI_REFERENCES_MAX_ENTRIES` → `aiCfg.referencesMaxEntries`), breaking on whichever of entry-cap/char-budget trips first; small batches keep each call tractable and the output count stable. Added `finishReason`/`outputTokens` logging to `referencesDecider` to diagnose this class of issue. 1 new chunk test (+ config field). Restart the server to apply.
  - **Per-step model selection (2026-06-16):** each AI pass can now run on a different model — a single doc can use a strong model for heading classification (Step D) and a cheaper/faster one for proofreading (Step P). `AiConfig` gained `headingModel` / `referenceModel` / `proofreadModel`, each resolved from `AI_HEADING_MODEL` / `AI_REFERENCES_MODEL` / `AI_PROOFREAD_MODEL` and falling back to `AI_MODEL` when unset; the three deciders and the `processFormatting` "calling model" logs use their step model. Live `.env`: Step D/C on `nemotron-3-ultra-550b-a55b:free`, Step P overridden to `nemotron-3-nano-30b-a3b:free`. 2 new config tests; documented in `.env.example`. **Note:** do not use nano for Step C — it over-reasons and corrupts JSON output. `AI_REFERENCES_MODEL` was reset to ultra after a 2026-06-19 incident (7290 reasoning tokens, malformed JSON, `NoObjectGeneratedError`).
  - **Step C JSON repair hardening (2026-06-19):** `headingDecider.ts` now has `sanitizeControlChars()` which is called at entry of `repairDecisions` — escapes `U+0000–U+001F` inside JSON string values before any parse attempt, so the entire repair chain works on clean text even when a reasoning model embeds a literal newline in its output. Fixes both Step C and Step D (the latter imports `repairDecisions`). `AI_REFERENCES_MODEL` also corrected to ultra in `.env`.
  - **Illegal-XML-char corruption (2026-06-16):** a full-flow run produced a processed `.docx` whose `word/document.xml` was unparseable, so docx-preview threw and `ProjectDetailPage`'s `DocxViewer` rendered a blank pane (`if (loadError) return null`). Root cause (found by downloading the stored processed file with the service-role key and parsing it): a single **NUL byte** (` `) the model emitted inside a Step C reference segment (`…<w:t>\x00ABNT.`) got spliced into the XML raw — `escapeXml` only handled `& < >`, not the C0 control chars XML 1.0 forbids, so one stray NUL made the whole document invalid. Fix: new shared `xmlText.ts` (`escapeXml` + `stripInvalidXmlChars`) strips the illegal C0 set (everything < U+0020 except `\t \n \r`) and U+FFFE/U+FFFF before escaping, preserving accents and astral chars (emoji). Both AI splice points now import it — `stepC.ts` (references) and `runs.ts` (proofread replacement); their duplicated local `escapeXml`s are gone. 6 new unit tests (`xmlText.test.ts`); server suite now 146 passing. (Existing already-corrupted files in storage need reprocessing — the fix only affects new runs.)
- [x] DOCX formatting function — see [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md) for full breakdown
  - Five-step pipeline: (A) deterministic — rewrite `styles.xml` per guideline, strip direct overrides, fix margins; (B) deterministic — detect references section, apply hanging indent + spacing; (C) AI — reformat reference entries to guideline citation format (Haiku/GPT-4o-mini); (D) AI — heading reclassification; (E) repack → upload → stamp DB. AI only touches semantics; layout is deterministic XML.
  - **Progress (migrating off n8n → server, per `business_decisions/n8n-vs-server.md`):** Steps A & B implemented server-side in `server/src/lib/formatting/` (pure transforms: `rewriteStyles`, `stripDirectOverrides`, `rewriteMargins` in `applyStepA`; `formatReferences` for Step B; zip via `docxZip`) + orchestrator `server/src/lib/processFormatting.ts` (download → Step A → Step B → re-zip → upload `processed/` → stamp `status='complete'` → ready email). Triggered by `POST /api/processing/start` (`x-webhook-secret`, in-process async, 202). 33 unit + real-fixture tests pass (vitest). Canonical guideline spec: `server/src/lib/formatting/specs/abnt.md` — now the **live single source of truth**: `getGuideline()` reads the spec's machine block at runtime (`loadGuideline.ts`, parsed with JSON5 + validated with zod, cached by file mtime so edits apply with no rebuild or restart), falling back to a built-in table in `guidelines.ts` only if a spec is missing or invalid. The spec also carries the `display` metadata that drives the guideline dropdown (see Onboarding). A copy step (`scripts/copySpecs.js`) ships the `.md` specs into `dist` for production builds.
  - **Architecture decision — references no longer split:** since processing left n8n, the separate references file is unnecessary. The plan is to store ONE file (selected pages incl. references); Step B detects the references section by heading text and `references_file_path` has been removed (the separate references file is gone). Step B is **bounded to the user-flagged `references_pages`** (not word-detection — "Referências" can appear in body text); flagged pages are mapped to paragraphs via pagination signals (manual page breaks / `sectPr` / `lastRenderedPageBreak` / 40-block fallback). Step C (AI reference reformatting) is confirmed in-scope for later. The ABNT heading-font reconcile is **done** — body and headings now derive from a single `fonts.default`, enforcing one font per document (Arial and Times New Roman are both ABNT-valid, but never mixed); the `abnt.md` spec was clarified accordingly. **Step D (AI heading reclassification) is done** — built server-side via OpenRouter (OpenAI-compatible) + Vercel AI SDK (`generateObject` + zod), model-agnostic behind the `HeadingDecider` seam (`stepD.ts`, `ai/headingDecider.ts`, `ai/config.ts`, `ai/headingsPrompt.ts`). Shared block parser extracted to `blocks.ts`; `locateReferences` exported from `references.ts`; spec §4 drives the prompt via `loadGuidelineDoc`/`guidelineSection`. Wired into `processFormatting` behind the `AI_FORMATTING_ENABLED` flag with graceful fallback (an AI failure keeps the deterministic A/B result). 17 new offline unit tests (fake decider, no network) + a gated live eval (`RUN_AI_EVALS=1`) that passed against `openai/gpt-oss-120b:free` (promoted 2 plain-text headings, 0 blocks lost). Per-level heading caps/bold in Step A is **done** — `rewriteStyles` builds Heading1/2/3 from the spec's `headings.levels` (H1 caps+bold, H2 caps, H3 sentence+bold; one size, ABNT differentiates by case+bold not size). Step D also logs each identified heading (tier + page) to the server console. **Step C (AI reference reformatting) is done** — same model-agnostic pattern as Step D, behind the `ReferenceDecider` seam (`stepC.ts`, `ai/referencesDecider.ts`, `ai/referencesPrompt.ts`, `prompts/reference-reformatting.md`). It chunks the located references region's entries (each independent, no cross-chunk context), the model returns `[{ i, segments: [{ text, emphasis? }] }]`, and deterministic code renders the segments into `<w:r>` runs (bold/italic) and splices over each entry by absolute index, keeping Step B's `<w:pPr>`; an entry with no usable segments is left unchanged. The decider reads spec §6 (rules) + §7 (examples) and reuses `headingDecider`'s `repairDecisions`. Wired into `processFormatting` (A → B → C → D) behind `AI_FORMATTING_ENABLED`, each AI pass independently try/caught. 14 new offline unit tests (fake decider) + a gated live eval (`stepC.eval.test.ts`); server suite now 77 passing. **Step C confirmed live (2026-06-17)** — bold renders correctly in a real end-to-end upload. **Still pending:** unnumbered-title style (RESUMO/SUMÁRIO) in Step A; migrate proofreading off n8n.
  - **First-H1 page break (2026-06-14):** `Heading1`'s style carries `<w:pageBreakBefore/>` (every H1 starts a new page), but the **first** H1 must not — it would isolate a lone title or add a blank page after an already-paginated cover. New `pageBreaks.ts` (`suppressFirstHeadingPageBreak`) injects a direct `<w:pageBreakBefore w:val="false"/>` on the first `Heading1` paragraph (overrides the style for it alone). Runs after the AI passes in `processFormatting` (the first H1 may be one Step D promoted). 4 unit tests; spec §4/§9 updated.
  - **List indentation (2026-06-14):** Word's per-level default (720 twips ≈ 1.27 cm) makes deeply-nested items very wide. New `normalizeNumbering.ts` → `normalizeNumberingXml` rewrites every `<w:lvl>` in `word/numbering.xml` to step = 480 twips (≈ 0.85 cm), hanging = 240, applied right after `unzipDocx` before Step A. 5 unit tests. Tune with `STEP` constant.
  - **Image captions (2026-06-14):** added a deterministic, label-anchored caption pass. Around each image (`<w:drawing>`/`<w:pict>`/`<w:object>`) the paragraph **before** is styled `Caption` only when it opens with a figure label (`Figura 1 —`, `Imagem 2 -`, `Gráfico 3:`) and the paragraph **after** only when it opens with a source label (`Fonte:`) — so body text wrapping an inline image is never shrunk. `Caption` = centered, 10pt, single. New `Caption` style in `rewriteStyles`, values from `GuidelineSpec.caption` (parsed from the spec's §8 `caption` block); pass in `captions.ts` (`formatCaptions`) swaps only the matched neighbor's `<w:pStyle>` by absolute index and runs last in `processFormatting` so an AI heading promotion can never override it. Documented in `abnt.md` §11. 8 caption tests + a style test; suite 94 passing. Live confirmation pending (no image in the test fixture yet).
  - **Image sizing & centering (2026-06-17):** Word embeds pictures at the absolute size from the source doc, so figures arrive oversized/arbitrary. New deterministic `imageLayout.ts` → `formatImages(documentXml, guideline)` normalises every **inline** image (`<wp:inline>`) to `IMAGE_WIDTH_FRACTION` (0.7) of the page content width — preserving aspect ratio — and centers its paragraph (`<w:jc w:val="center"/>`). Content width = `<w:pgSz>` width − guideline left/right margins, in EMU (635 EMU/twip). Reads the primary `<wp:extent>` to compute one scale factor, then applies it to every `cx`/`cy` pair in the drawing (`wp:extent` + inner `a:ext`); `<wp:effectExtent>` (l/t/r/b) and `<a:off>` (x/y) are untouched. Anchored/floating images (`<wp:anchor>`) are skipped (own positioning/wrap). Runs first in the "final deterministic touches" block of `processFormatting`, before `formatCaptions`. 8 unit tests (`imageLayout.test.ts`). Live confirmation pending (no image in the test fixture yet).
  - **Step D robustness (2026-06-13):** two output bugs from a real run were fixed. (1) The pass was promoting numbered **list items** to headings — they read identically to numbered headings by text alone, and promoting one breaks the list's numbering (all items restart at "1"). Now list items are detected via `isListItem()` (`<w:numPr>`) in `blocks.ts`, excluded as heading candidates in `chunkHeadings`, refused in `applyHeadingDecisions` even on an explicit decision, and called out in the prompt. (2) A sibling among several identical headings was jumping a level because the `atPageStart` cue was weighted as a "strong h1 sign"; the prompt now treats it as a weak signal and adds a "treat parallel headings identically" rule. 2 new regression tests; formatting suite green.
  - **Done:** frontend stores one file (references inline; the `references_file_path` column has been removed); `ProjectDetailPage` viewer handles the single file. **Trigger cutover done for both services** — `CheckoutPage` calls `POST /api/processing/start` (Bearer = project owner's Supabase token) after the row is created whenever formatting **or** proofreading is requested; the old n8n `/notify` path for proofreading-only is gone. The `/processing/start` route accepts the owner's Bearer token OR the `x-webhook-secret` (manual/curl).
- [x] Convert processed `.zip` back to `.docx` for delivery
  - n8n repacks the processed output as `.docx` and stamps `processed_file_path` + `status = complete` in the `projects` table
- [ ] Migrate proofreading off n8n into the server
  - When building the server-side proofreading pipeline, use `applyPunctNorm` (`server/src/lib/formatting/applyPunctNorm.ts`) as the first deterministic step before any AI call. It normalises double spaces, space-before-punctuation, and ellipsis characters with zero token cost. The AI then handles only the remaining grammatical work.
  - **LanguageTool** is a candidate for a deeper rule-based layer between `applyPunctNorm` and the AI. It is open-source, has hundreds of Portuguese grammar and punctuation rules, and is fully deterministic (no model calls). Two deployment options: self-hosted Java server (free, private, heavyweight) or the public HTTP API (simple, ~$0.001/request batch). It could handle agreement, accent, and word-order errors that the simple normaliser misses, while the AI handles fluency and style. Not a commitment — evaluate when the proofreading migration is actually scoped.

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

- [x] DOCX formatting pipeline
  - All steps complete: (A) deterministic styles/margins, (B) references layout, (C) AI reference reformatting, (D) AI heading reclassification, (E) repack → upload → stamp. Full breakdown in [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md).

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` set but nothing acts on it. Query rows where `delete_files_at < now()` and `files_deleted_at is null`, delete from Supabase Storage, stamp `files_deleted_at`. Options: pg_cron, Supabase Edge Function, or n8n scheduled workflow.

- [x] Email notification when project is ready
  - `POST /api/notifications/project-ready` implemented and wired into the pipeline (sent on `complete` and after finalize-inputs resolves).

- [ ] Landing page redesign
  - Full visual overhaul of `LandingPage.tsx` and sections (`Hero.tsx`, `Services.tsx`, `Pricing.tsx`). Stronger value proposition, social proof, conversion-focused layout.

---

## Pre-Deploy Checklist

- [x] Processed file storage + download button
  - n8n uploads processed file to Storage and stamps `processed_file_path` + `status = complete`. Frontend fetches both signed URLs on load; "Baixar Arquivo Final" (primary) shows only when `status === 'complete'`, "Baixar Arquivo Original" (tertiary) always available.

- [ ] File auto-deletion cron job
  - `projects.delete_files_at` is set (30 days after submission) but nothing acts on it. Before deploying, wire up a scheduled job that: queries `projects` where `delete_files_at < now()` and `files_deleted_at is null`, deletes both `original_file_path` and `processed_file_path` from Supabase Storage, then stamps `files_deleted_at`. Options: pg_cron inside Supabase, a scheduled Supabase Edge Function, or an n8n scheduled workflow.
