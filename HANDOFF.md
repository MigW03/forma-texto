# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below, not here.

**Last updated:** 2026-06-19 (later 6)

---

## What this is

FormaTexto — an AI-powered academic document formatting and proofreading service
(Brazil-first, ABNT). Users upload a `.docx`/`.pdf`, pick services and pages, pay,
and the backend formats/corrects the file with a multi-model AI pipeline.

Deeper docs (keep these as the real source of truth):
- [`CLAUDE.md`](CLAUDE.md) — architecture, design system, routes, conventions.
- [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md) — the DOCX formatting pipeline.
- [`PLAN.md`](PLAN.md) — feature plan and status checklist.
- [`supabase_tables.md`](supabase_tables.md) — database schema.

## Layout

- `web/` — React 19 + Vite + TypeScript frontend (shadcn/ui, Supabase, Stripe, i18next).
- `server/` — Express + TypeScript backend (Stripe, Supabase service-role, email, the formatting pipeline).
- `docs/`, `business_decisions/` — documentation and decision records.

---

## Current status

- **Branch:** `feature/docx-page-detection` — lauda-based billing migration + pipeline improvements. All changes committed.
- **Build:** web production build **verified green (2026-06-17)** (`npm run build` in `web/`).
- **Tests:** server **173** passing (3 AI evals skipped); web **32** passing.
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer,
  the DOCX formatting pipeline Steps A/B/C/D (both AI passes: reference reformatting + headings),
  and the server-side proofreading pass (Step P) — proofreading is no longer on n8n.
- **Key change:** billing unit moved from pages to laudas (~300-word units). Only `.docx` files accepted
  now (PDF removed as input). See session log 2026-06-13.

## Pipeline state (formatting)

- **Step A** (deterministic styles/overrides/margins) — built, tested.
- **Step B** (deterministic references layout) — built, tested.
- **Step C** (AI reference reformatting) — **built, unit-tested, and confirmed live (2026-06-17)**. Returns `[{ i, segments }]`; deterministic code renders runs and splices over each entry, keeping Step B's `<w:pPr>`. Behind `AI_FORMATTING_ENABLED`. Bold renders correctly in the output `.docx` on a real upload.
- **Step D** (AI heading reclassification) — built, tested, and confirmed working live.
- **Step E** (re-zip / upload / stamp / email) — built.
- **Image sizing** (deterministic) — built, unit-tested. `imageLayout.ts` `formatImages`
  scales every `<wp:inline>` image to 70% of the page content width (aspect preserved) and
  centers its paragraph; floating `<wp:anchor>` images are skipped. Runs first in the final
  deterministic touches (before captions). **No image in the test fixture yet** — live check pending.
- **Image captions** (deterministic) — built, unit-tested. Around each image
  (`<w:drawing>`/`<w:pict>`/`<w:object>`) the pass styles the paragraph **before** as
  `Caption` only when it opens with a figure label (`Figura 1 —`, `Imagem 2 -`, `Gráfico 3:`)
  and the paragraph **after** only when it opens with a source label (`Fonte:`). Label-anchored
  so body text wrapped around an inline image isn't shrunk. `Caption` = centered, 10pt, single.
  Runs last in the orchestrator so an AI heading promotion can never override it.
  **No real-doc check yet** (no test fixture has an image).
- **List indentation** (deterministic) — `normalizeNumberingXml` rewrites every `<w:lvl>` in
  `word/numbering.xml` before any other pass runs. Per-level step is 480 twips (≈ 0.85 cm),
  down from Word's default 720 twips/level; hanging = 240 for all levels. Applied in
  `processFormatting` right after `unzipDocx`. 5 unit tests in `normalizeNumbering.test.ts`.
  Adjust the `STEP` constant in `normalizeNumbering.ts` to tune.
- **First-H1 page break** (deterministic) — `Heading1`'s style carries `<w:pageBreakBefore/>`
  (every H1 starts a new page), but `suppressFirstHeadingPageBreak` cancels it on the **first**
  H1 via an inline `<w:pageBreakBefore w:val="false"/>` override. Runs after the AI heading pass
  (the first H1 may be one Step D promoted). Avoids a lone-title page / blank page after a cover.
- **Step P** (AI proofreading) — built, unit-tested, and **validated live on the free model**.
  Fixes grammar, punctuation, spelling, verb-tense consistency, and ABNT in-text citation
  casing without changing meaning, the title, the references, or intentional run formatting.
  The model returns corrected paragraph text (`[{ i, text }]`, changed paragraphs only); a
  deterministic char-diff (`textDiff.ts`) maps each edit onto the run it falls inside
  (`runs.ts`), preserving every other run byte-for-byte. An edit crossing a formatting
  boundary — or a paragraph with a hyperlink/field/footnote — leaves the paragraph unchanged.
  Scope: headings + body + list items; skips title, references (auto-detected), tables,
  captions. Runs after the formatting passes (so heading classification is done → batches by
  chapter). Behind `AI_PROOFREADING_ENABLED`; proofreading-only projects skip all formatting
  passes. The live eval changed the right two paragraphs and left references/title untouched.

---

## Operational gotchas (read before debugging)

- **Run the server with `npm run dev`** (ts-node-dev on the source). `npm start` runs the
  compiled `dist/`, which is **gitignored and can go stale** — a stale `dist` that predated
  Step D was the cause of "Step D not working" this session. If you must use `npm start`,
  run `npm run build` first.
- **`server/.env` is loaded once at startup** (`dotenv/config`). After changing it (e.g.
  `AI_FORMATTING_ENABLED` or `AI_PROOFREADING_ENABLED`), **restart the server** for the
  change to take effect. The two AI flags are independent: formatting (Steps C/D) and
  proofreading (Step P) are turned on separately.
- **Step D is behind `AI_FORMATTING_ENABLED=true`** and an OpenRouter key. An AI failure is
  **non-fatal by design**: it logs `[processFormatting] … Step D failed (non-fatal …)` and
  keeps the deterministic A/B result. So "no AI headings" can mean the flag is off, the call
  errored, or the doc simply had no plain-text headings to promote (Step D only *promotes*,
  never demotes).
- **AI model — per-step.** `AI_MODEL` is the default; each pass can override it via
  `AI_HEADING_MODEL` (Step D), `AI_REFERENCES_MODEL` (Step C), `AI_PROOFREAD_MODEL` (Step P), each
  falling back to `AI_MODEL` when unset (resolved in `config.ts` → `headingModel`/`referenceModel`/
  `proofreadModel`; the "calling model" logs print the per-step slug). Config-file default is
  `nemotron-3-super-...:free`; **current `.env`: `AI_MODEL=nemotron-3-ultra-550b-a55b:free`
  (Step D), `AI_REFERENCES_MODEL=nvidia/nemotron-3-nano-30b-a3b:free` (Step C),
  `AI_PROOFREAD_MODEL=nemotron-3-nano-30b-a3b:free` (Step P)** — ultra for headings, nano for
  references and proofreading. `AI_MAX_TOKENS=8192` and `AI_MAX_CHARS_PER_CHUNK=3000` —
  reasoning models need the larger token budget or JSON truncates mid-response. **Step P has its
  own token budget** `AI_PROOFREAD_MAX_TOKENS` (default 4096) so proofreading generations are
  shorter (faster, fewer mid-stream resets) without starving Step C/D.
  **Watch nano on Step C and Step P:** it's small (30B/3B active) — if reference reformatting or
  proofreading quality degrades, bump to super or ultra. Nano works on Step C now that
  `sanitizeControlChars` (added 2026-06-19) handles its occasional control-char JSON output.
- **Free models drop the socket mid-response** (`ECONNRESET`/"terminated", `200` then body killed).
  The AI SDK marks these `isRetryable:false`, so `ai/retry.ts` (`withConnectionRetry`) wraps all
  three deciders' `generateObject` calls and retries only transport resets (backoff + jitter; reuses
  `AI_MAX_RETRIES`). HTTP-status retries stay the SDK's job.
- **OpenRouter free tier = 50 requests/day, account-wide** (`429 "Rate limit exceeded:
  free-models-per-day"`). Once exhausted, **every** AI pass (Step C/D/P) fails until the daily
  reset — all are non-fatal, so the job still finishes (deterministic formatting + placeholders
  run), but the doc gets no AI heading/reference/proofreading work. Add credits to OpenRouter
  (unlocks 1000/day) or wait for reset. This affects Steps C/D/P only — all non-fatal, so the job finishes with deterministic formatting only.
- **All model-authored text is sanitized before it touches XML.** A stray NUL byte from the model
  once corrupted a Step C reference splice and made the whole `document.xml` unparseable (viewer went
  blank). `formatting/xmlText.ts` `escapeXml` now strips XML-1.0-illegal control chars before escaping;
  used by `stepC.ts` and `runs.ts`.
- **`repairDecisions` now sanitizes control chars before any parse attempt.** The nano model (when used
  for Step C) sometimes emits a literal `0x0A` newline inside a JSON string value — invalid per RFC 8259,
  causing every parse in `repairDecisions` (JSON.parse, the array-extract fallback, and
  `salvageCompleteDecisions`) to fail. `headingDecider.ts` `sanitizeControlChars` escapes all
  `U+0000–U+001F` inside JSON string values (tracking string/escape state char-by-char) and is called at
  the top of `repairDecisions` so the entire repair chain works on clean text. Since `referencesDecider`
  imports `repairDecisions` from `headingDecider`, this fixes both Step C and Step D. The root cause
  (nano over-reasons on Step C — 7290 reasoning tokens for 1 entry, leaving ~661 tokens of corrupted
  output) is also fixed: `AI_REFERENCES_MODEL` is now set to ultra in `.env`.
- **Gated live evals** for the AI path (no spend in CI), e.g. for Step D:
  `cd server && set -a; . ./.env; set +a; RUN_AI_EVALS=1 npx vitest run src/lib/formatting/stepD.eval.test.ts`.
  Step C has a sibling `stepC.eval.test.ts`, but its fixture page flags (`refInput`) are a
  **guess** — point `selectedPages`/`referencePages` at the real references page of
  `test_assets/formatting_test_input.docx` (or a doc that has one) or it self-skips.
- Some `.md` files under `server/src/lib/formatting/` are **live code inputs**, not docs:
  `specs/abnt.md` is parsed at runtime and `prompts/heading-classification.md` is the Step D
  prompt. Don't "simplify" them casually.

---

## Open work / next steps

- [x] ~~**Confirm Step C live**~~ — **confirmed 2026-06-17**. Bold renders correctly in the output `.docx`.
- [ ] **Merge `feature/docx-page-detection`** into main — build not yet verified.
- [x] ~~Migrate proofreading off n8n into the server~~ — done (Step P). Live-confirm on a real
      multi-page `.docx` upload (the inline eval fixture passed; one real end-to-end run pending).
- [x] ~~Bug — references-formatting option shown without the formatting service.~~ **Fixed
      (2026-06-16).** `PageSelectionPage.tsx` now derives `showReferences = activeServices.has('formatting')`;
      the references card is hidden for proofreading-only orders, no longer gates Continue
      (`referencesValid = !showReferences || …`), and `formatReferences` is sent as `undefined` unless
      formatting is selected. Step P still auto-detects + skips references server-side regardless.
      tsc clean; not browser-verified (will be covered by the next full-flow run).
- [ ] **PDF export — install LibreOffice + live-confirm.** DOCX→PDF export is built
      (`server/src/lib/docxToPdf.ts`, wired into `processFormatting` step 6b, "Baixar PDF Final"
      button in `ProjectDetailPage`) but **untested end-to-end — LibreOffice isn't on the dev
      machine.** Install it (`brew install --cask libreoffice`) and set
      `SOFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice` in `server/.env`, restart,
      reprocess a doc → PDF button should appear. Verify ABNT margins/pagination survive (fonts:
      install Arial/Times or rely on Liberation metric-compatibles).
- [ ] **Production hosting for the PDF export.** LibreOffice is a system binary, not npm — it must
      exist wherever the server runs. **Not viable on serverless (Vercel/Lambda).** Use a Docker
      container (`apt-get install libreoffice-writer fonts-liberation`) or a Gotenberg sidecar
      (HTTP-wrapped LibreOffice — would swap `docxToPdf.ts`'s shell-out for a `GOTENBERG_URL` call).
      No host chosen yet. The export is non-fatal, so prod runs fine without it until decided.
- [ ] File auto-deletion cron (`projects.delete_files_at` is set but nothing acts on it).
- [ ] Optional: add tests for the DOCX slicer (`docx-slice.ts`); extend test fixture with an image
      to confirm `formatCaptions` end-to-end on a real `.docx`.

---

## Session log

### 2026-06-19 (later 6) — Viewer load: diagnosed (region) + CDN caching fix

Timing probe results on a real 1.2 MB doc: **DB query ~320–580ms · signed URLs ~1.1–1.6s ·
file download ~3.4–4.0s · renderAsync 50ms.** So the render is NOT the bottleneck — it's all
Supabase network. A 1.5s round-trip just to *mint a signed URL* (a tiny operation) is the smoking
gun for **region latency**: the project is likely hosted far from Brazil. **Primary fix is infra:
confirm the Supabase project region is `sa-east-1` (São Paulo); if it's us-east/eu, migrate.** That
is the only thing that speeds up the *first* load (sign + origin download are region-bound).

Code fix shipped for **repeat** loads — the processed `.docx` was uploaded with `cacheControl: '0'`,
which disables CDN caching entirely, so every view was a full origin fetch. Changed both upload sites
(`processFormatting.ts`, `processing.ts` finalize) to `cacheControl: '3600'`, and reworked the client
cache-buster: `bustCache(url, version)` now keys on the project's `completed_at` (a stable per-content-
version token) instead of `Date.now()`. Same content version → same URL → CDN hit (fast); a finalize/
reprocess bumps `completed_at` → new URL → fresh bytes (no staleness — the original reason for `'0'`).
Added `completed_at` to the query + `ProjectDetail` + the realtime merge. **Only affects files uploaded
AFTER this change — reprocess a doc to test the cache win.** Restart the server.

Side notes from the probe: the **400 on the PDF signed URL** is just the missing `.pdf` (LibreOffice
not installed) — harmless. The **3× download** in the log is React StrictMode double-invoke in dev
(prod = 1×). Timing `console.log`s are still in place; remove them once region is confirmed/fixed.

### 2026-06-19 (later 5) — Viewer load timing instrumentation (Supabase latency probe)

The viewer's *loading indication itself* was slow to appear — pointing at the Supabase round-trips
that gate it, not the render. Before the DocxViewer even mounts the page runs two **sequential**
Supabase hops: (1) the `.single()` DB query, then (2) `createSignedUrl` ×3 (parallel). Then the
viewer does (3) `fetch(url)` to download the file from Storage (processed URL is cache-busted →
full re-download every view) and (4) `renderAsync` (CPU). Hops 1–3 are all Supabase and compound;
far region = +150–300ms each.

Added **temporary `console.log` timing** to pinpoint the bottleneck on a real load:
`[ProjectDetail timing] DB query` / `signed URLs` / `total to viewer`, and
`[DocxViewer timing] file download (+KB)` / `renderAsync`. **Remove these logs once the bottleneck
is identified.** Likely levers: confirm the Supabase project region is `sa-east-1` (São Paulo) for
Brazil-first users; relax the processed-file cache-bust for stable `complete` files; optionally batch
the 3 signed-URL calls via `createSignedUrls` (plural).

### 2026-06-19 (later 4) — Viewer loading feedback (anti-"frozen")

The project-detail document preview felt frozen on larger docs. Root cause: docx-preview's
`renderAsync` builds the whole document DOM **synchronously and blocks the main thread** (no
streaming/worker mode), so even the old pulse-skeleton animation stalled mid-render — looked
crashed. No clean way to make the render itself faster.

Fix in `web/src/pages/ProjectDetailPage.tsx` (`DocxViewer`):
- **Yield before render.** After `fetch → blob`, `await` a double `requestAnimationFrame` before
  calling `renderAsync`, so the browser paints the loading state *before* the main-thread freeze.
  Without this the spinner never showed.
- **Real loading UI.** Replaced the bare pulsing page rectangles with a centered `Loader2`
  spinner + `project.loadingPreview` ("Carregando documento…") + `project.loadingPreviewHint`
  ("Documentos maiores podem levar alguns segundos…"). The freeze now reads as "working," not broken.
- Two i18n keys added to all 3 locales. Also covers the post-finalize `window.location.reload()` path.

tsc clean, web 32 tests pass. Not browser-verified (viewer needs an authed project + real doc).

### 2026-06-19 (later 3) — Step C → nano + finalize page reload

**Step C model** (`server/.env`): `AI_REFERENCES_MODEL` changed from `nemotron-3-super-120b-a12b:free`
to `nvidia/nemotron-3-nano-30b-a3b:free`. Nano now on both Step C and Step P. Confirmed working —
`sanitizeControlChars` (added earlier today) handles the control-char corruption that previously
made nano unusable on Step C. Restart the server to apply.

**Finalize page reload** (`web/src/pages/ProjectDetailPage.tsx`): `handleFinalize` now calls
`window.location.reload()` on a successful POST response instead of relying on the Realtime
subscription to patch the viewer in place. On error the catch block still clears `finalizing`.
The Realtime handler's re-sign path remains for the normal `processing → complete` transition.

### 2026-06-19 (later 2) — Switch Step C model from ultra to super

`AI_REFERENCES_MODEL` in `server/.env` changed from `nvidia/nemotron-3-ultra-550b-a55b:free` to
`nvidia/nemotron-3-super-120b-a12b:free`. Step D (headings) stays on ultra via `AI_MODEL`.
Restart the server to apply.

### 2026-06-19 (later) — Fix Step C `NoObjectGeneratedError` (control chars + wrong model)

Two-part fix for `NoObjectGeneratedError` thrown by `referencesDecider` during Step C:

1. **Model config** (`server/.env`): `AI_REFERENCES_MODEL` was set to `nemotron-3-nano-30b-a3b:free`. The nano model is a reasoning model — it burned 7290 reasoning tokens on a single 1-entry chunk (3 entries max), leaving only 661 tokens for actual JSON output, which arrived corrupted (literal `0x0A` newline inside a JSON string value). Changed to `nvidia/nemotron-3-ultra-550b-a55b:free` (same as `AI_MODEL`), matching the documented intent. Restart the server.

2. **Code fix** (`server/src/lib/formatting/ai/headingDecider.ts`): Added `sanitizeControlChars(text)` — walks the raw model output char-by-char tracking string/escape state and replaces any `U+0000–U+001F` control character inside a JSON string with `\uXXXX`. Called at the top of `repairDecisions` so ALL fallback paths (JSON.parse, array-extract, `salvageCompleteDecisions`) work on clean text. Since `referencesDecider` imports `repairDecisions`, this also hardens Step D against the same class of model output bug.

Tests: 173/176 (3 evals skipped), `tsc` clean.

### 2026-06-19 — Rebuild interactive input feature (batch finalize + side panel)

Rebuilt the `needs_input` caption-fill feature from scratch with a fundamentally different architecture that eliminates the root causes of the previous bug (placeholder reappearing after delete).

**Core change:** no per-edit server writes. All fills and removals live in local React state. One "Save & finalize" button sends everything atomically to `POST /api/processing/finalize-inputs`, which applies all changes in a single `replaceBlocks` pass and stamps `complete`.

**Server:**
- `server/src/lib/formatting/missingInputs.ts` (new) — `detectAndInsertPlaceholders` (walks image/table blocks, inserts red Caption-style placeholder `<w:p>` for absent captions/sources, returns modified XML + `PendingInput[]` with cumulative `insertedAt`), `finalizeInputs` (one `replaceBlocks` call for all fills+removals). 16 unit tests in `missingInputs.test.ts`.
- `server/src/lib/formatting/index.ts` — added `detectAndInsertPlaceholders`, `finalizeInputs`, `PendingInput`, `MissingInputKind` exports.
- `server/src/lib/processFormatting.ts` — calls `detectAndInsertPlaceholders` after `formatCaptions`; branches step 7: `pending.length > 0` → stamps `needs_input + pending_inputs` (no email); else → stamps `complete + pending_inputs: null` (+ email).
- `server/src/routes/processing.ts` — added `POST /api/processing/finalize-inputs`: validates status=`needs_input`, all IDs known, all slots resolved; downloads DOCX → `finalizeInputs` → re-upload `cacheControl:'0'` → stamp `complete` → send ready email (non-fatal).

**Frontend:**
- `web/src/lib/status.ts` — re-added `needs_input` to union + `STATUS_BADGE_VARIANT`.
- `web/src/components/ui/badge.tsx` — re-added `needs_input: bg-orange-50 text-orange-700 border-orange-200`.
- `web/src/pages/DashboardPage.tsx` — `needs_input` counted as active.
- `web/src/pages/ProjectDetailPage.tsx` — `PendingInputFE` type, `pending_inputs` in DB query, `fills`/`removals`/`finalizing`/`finalizeError` state, `handleFinalize` (POST + let realtime handle transition), side panel in details column (one row per pending input: label + textarea + remove/restore; "Save & finalize" disabled until all resolved). `canSeeProcessed` = `complete || needs_input`; `canDownloadProcessed` = `complete` only. Realtime handler: re-signs on path change for `needs_input`, always re-signs with cache buster on `complete`.
- All 3 locale files: `dashboard.status.needs_input`, `project.inputs.*` block (title, per-kind labels, placeholders, finalize/remove/restore/error strings).
- `web/src/lib/status.test.ts` — re-added `needs_input` test case.

Build: server 173/176 (3 evals skipped), web build green, tsc clean both sides.

**Finalize UX fixes (same session):**
- **Server idempotency** — `POST /api/processing/finalize-inputs` now returns `{ ok: true }` when the project is already `complete` (was 409). Safe to retry after a network hiccup or double-click without showing an error.
- **Double-submit guard** — `finalizingRef` (a `useRef`) blocks a second `handleFinalize` invocation synchronously, before React has had a chance to re-render the button as disabled.
- **Stuck saving state** — Supabase Realtime fires (via WebSocket) before the HTTP response returns, so `finalizing` was staying `true` while the fetch was still in-flight. The Realtime handler now clears `finalizingRef.current` and calls `setFinalizing(false)` immediately when it sees `status = 'complete'`, so the panel unsticks as soon as the server confirms the write.

**Still pending:** live end-to-end verify — reprocess a `.docx` with an image/table missing a caption or source to confirm the `needs_input` → fill → `complete` flow works end-to-end.



### 2026-06-16 (later 2) — Full-flow hardening + PDF export

First real end-to-end runs of the full flow surfaced three things, all addressed:

- **Connection-reset resilience.** A run hit `ECONNRESET`/"terminated" mid-response from the free
  model (request `200`, then the body socket dropped); the AI SDK marks this `isRetryable:false`, so
  its own `maxRetries` never fired and a whole Step P chunk was lost. New `ai/retry.ts`
  (`withConnectionRetry` + `isConnectionResetError`, walks the `cause` chain) wraps the
  `generateObject` call in all three deciders and retries only transport resets (backoff + jitter,
  reuses `AI_MAX_RETRIES`), leaving HTTP-status retries to the SDK. Also gave Step P its own
  `AI_PROOFREAD_MAX_TOKENS` (default 4096) so its generations are shorter. 8 unit tests.
- **Blank-viewer corruption — root cause found.** After a run the processed file rendered as a blank
  pane. Downloaded the stored `.docx` with the service-role key and parsed it: a single **NUL byte**
  the model emitted inside a Step C reference segment (`…<w:t>\x00ABNT.`) had been spliced in raw —
  `escapeXml` only handled `& < >`, not the C0 control chars XML 1.0 forbids, so one NUL made the
  entire `document.xml` unparseable → docx-preview threw → `DocxViewer` rendered `null`. Fix: shared
  `formatting/xmlText.ts` (`escapeXml` + `stripInvalidXmlChars`) strips illegal chars before escaping;
  both AI splice points (`stepC.ts`, `runs.ts`) import it, deleting their duplicate locals. 6 unit
  tests. (Flagged a follow-up: `DocxViewer` should show an error+download fallback, not a blank pane.)
- **PDF export (new feature).** The pipeline now exports a PDF beside the processed `.docx` via a
  headless LibreOffice (`server/src/lib/docxToPdf.ts`, `soffice --convert-to pdf`, private per-call
  profile) for true Word fidelity. Uploaded to the same `processed/` path with a `.pdf` extension —
  **non-fatal** (missing/broken LibreOffice is logged and skipped, `.docx` still ships). `ProjectDetailPage`
  derives the path (`pdfPathFor`), signs it in both load + realtime handlers, and shows a second
  "Baixar PDF Final" button only when the signed URL resolves. New i18n key `project.downloadFinalPdf`
  (3 locales), `SOFFICE_PATH` documented in `.env.example`. **No DB column** (path convention).
  **Untested live — LibreOffice not installed yet** (see Open work).
- **Model:** switched `.env` `AI_MODEL` to `nvidia/nemotron-3-ultra-550b-a55b:free` to test whether a
  stronger free model fixes a heading-recognition regression on one doc (Step D under-promoting). The
  config-file default is unchanged (still `super`). Restart the server to pick it up.
- Server suite **146 passing**, `tsc` clean both sides.

### 2026-06-16 (later 4) — Step C reference batching fix

Step C reformatted only a fraction of the references and the count varied run-to-run on the same
doc (10 sent → 2, then 6; nano returned 1). Added `finishReason`/`outputTokens` logging to
`referencesDecider`, which showed `sent=10 got=1 finishReason=stop outTokens=7978` — **not**
truncation (`stop`, not `length`) and **not** routing: the model simply over-reasoned a 10-entry
batch and returned almost nothing. Root cause: references are short, so the char budget packed all
10 into one call. Fix: `chunkReferences` now caps **entries per chunk** (`maxEntries`, default 3,
env `AI_REFERENCES_MAX_ENTRIES`, threaded as `aiCfg.referencesMaxEntries`), breaking on whichever of
entry-cap / char-budget trips first. Small batches keep each call tractable and the count stable.
Also set live `.env` `AI_REFERENCES_MODEL=nemotron-3-nano-...:free` (references no longer need the
heavy model once batches are small). 1 new chunk test; suite **149 passing**, `tsc` clean. Restart
the server to apply. **Partially confirmed live:** a post-fix chunk logged `sent=1 got=1
finishReason=stop outTokens=291` — clean full return on ~291 tokens vs the old ~8k-token, mostly-dropped
batch. Still to confirm in one run: all 4 chunks (`3/3/3/1`) each return `got==sent` and the Step C
summary reports `reformatted 10`.

### 2026-06-16 (later 3) — Per-step AI models

Each AI pass can now run a different model (the user wants nemotron-ultra for heading
classification but a lighter model for proofreading). `AiConfig` gained `headingModel` /
`referenceModel` / `proofreadModel`, resolved from `AI_HEADING_MODEL` / `AI_REFERENCES_MODEL` /
`AI_PROOFREAD_MODEL` and each falling back to `AI_MODEL` when unset. The three deciders and the
`processFormatting` "calling model" logs use their step's model. Live `.env`: Step D/C on
`nemotron-3-ultra-550b-a55b:free`, Step P overridden to `nemotron-3-nano-30b-a3b:free`. 2 new config
tests; documented in `.env.example`. Server suite **148 passing**, `tsc` clean. **Restart the server**
to apply. Not committed yet.

### 2026-06-16 (later) — Step P: server-side proofreading

Brought proofreading onto the server (the last service still on n8n), built like Steps C/D —
the model never emits XML.

- **New apply core.** `textDiff.ts` (a small character-level LCS diff → `{ aStart, aEnd,
  replacement }` hunks, isolating each edit) and `runs.ts` (parse a paragraph into runs,
  coalesce adjacent same-`rPr` runs, map each diff hunk onto the single run it falls inside,
  re-splice). This is what lets a correction land without flattening intentional bold/italic/
  link runs. An edit crossing a real formatting boundary, or a paragraph with a hyperlink/
  field/footnote, is refused (paragraph left unchanged).
- **`stepProofread.ts`** — `chunkProofread` (batches by chapter: a new chunk at each
  `Heading1`, then by char budget; skips title, captions, references via `refStartIndex`,
  tables, and unsafe paragraphs), `applyProofreadDecisions`, and the `stepProofread`
  orchestrator. Model returns `[{ i, text }]` for changed paragraphs only.
- **`ai/proofreadDecider.ts` + `ai/proofreadPrompt.ts` + `prompts/proofreading.md`** — mirror
  the Step C/D decider/prompt seam; the prompt is a rewrite of the old n8n proofreading prompt,
  retargeted to return corrected text (not XML) and pulling spec §5 (in-text citations) for the
  ABNT citation rules. Dropped the n8n prompt's XML-comment citation flagging and long-quote
  reflow (not expressible as a text diff — noted as future).
- **Orchestrator** (`processFormatting.ts`) generalized: runs when formatting **and/or**
  proofreading is requested; formatting passes run only for `formatting`; Step P runs after
  them for `proofreading` (references excluded via the located region, else `autoLocateReferences`).
  Independent flag `AI_PROOFREADING_ENABLED` added to `ai/config.ts` + `.env.example`.
- **Trigger.** `CheckoutPage.tsx` now calls `POST /api/processing/start` for formatting **or**
  proofreading; the n8n `/checkout/notify` path for proofreading-only is gone.
- **Tests.** +29 offline unit tests (textDiff, runs, stepProofread) → server **132 passing**,
  `tsc` clean. Gated live eval (`proofread.eval.test.ts`) **passed on the free model**
  (`nvidia/nemotron-3-super-120b-a12b:free`): fixed agreement + accents + `(SILVA→Silva, 2020)`
  citation casing + a stray space, left the references entry and title byte-for-byte identical.
- **Open:** one real multi-page `.docx` end-to-end upload; tables/captions + citation
  flagging remain future work.

### 2026-06-16 — AI model update + housekeeping

- **AI model fallback** updated from `openai/gpt-oss-120b:free` to `nvidia/nemotron-3-super-120b-a12b:free`
  in both `server/src/lib/formatting/ai/config.ts` (hardcoded default) and `server/.env`. Default
  `maxTokens` raised to 8192 and `maxCharsPerChunk` lowered to 3000 in `config.ts` to match the `.env`
  values (reasoning models spend tokens on chain-of-thought before emitting JSON; a small budget truncates).
- **`/pg` suffix** in `GetStartedPage.tsx` pricing cards confirmed already fixed in the committed code —
  removed from open work.
- **Lauda branch** confirmed fully committed (`b7177ca` includes `laudas.ts`, all pipeline files,
  HANDOFF, PLAN). Branch is clean.

### 2026-06-14 (later 2) — Compact list indentation

Word's default `numbering.xml` adds 720 twips per indent level, making deeply-nested list
items very wide. New `normalizeNumbering.ts` → `normalizeNumberingXml(xml)` rewrites every
`<w:lvl>` in `word/numbering.xml`: level N gets `left = (N+1) × 480` twips, `hanging = 240`.
Applied in `processFormatting` immediately after `unzipDocx` (before Step A), so all later
passes see the normalised numbering. 5 unit tests. Tune via the `STEP` constant in the file.
Suite **103 passing**, `tsc` clean.

### 2026-06-14 (later) — Suppress page break before the first H1

`Heading1`'s style has `<w:pageBreakBefore/>` so every top-level section starts on a new
page. That is wrong for the **first** H1: it isolates a lone title on its own page, or adds
a blank page after a cover the source already paginated. New `pageBreaks.ts` →
`suppressFirstHeadingPageBreak(documentXml)`: finds the first `Heading1` paragraph and injects
a direct `<w:pageBreakBefore w:val="false"/>` (overrides the style for that one paragraph;
later H1s keep the break). Wired into `processFormatting` after the AI passes + `formatCaptions`,
because the first H1 may be a paragraph Step D just promoted. 4 unit tests; spec §4/§9 notes
updated. Suite **98 passing**, `tsc` clean.

### 2026-06-14 — Deterministic image captions

Added a deterministic image-caption pass (centered, 10 pt, single line spacing). It is
**label-anchored**: around each image, the paragraph **before** is styled `Caption` only
when it opens with a figure label (`Figura 1 —`, `Imagem 2 -`, `Gráfico 3:`), and the
paragraph **after** only when it opens with a source label (`Fonte:`). This avoids shrinking
ordinary body text that happens to wrap around an inline image.

- New `Caption` paragraph style built in `rewriteStyles` (Step A ships it in `styles.xml`).
  Values come from the spec — `GuidelineSpec.caption {sz,line}`, parsed from the §8 `caption`
  block (already present) in `loadGuideline`, with `{sz:20,line:240}` fallback in `guidelines.ts`.
- New `captions.ts` → `formatCaptions(documentXml)`: detects an image paragraph via
  `<w:drawing>`/`<w:pict>`/`<w:object>`, then swaps `<w:pStyle>` to `Caption` only on a
  neighbor whose text matches the relevant label (`FIGURE_LABEL_RE` before, `SOURCE_LABEL_RE`
  after). Layout lives in the style; merge by absolute block index via `replaceBlocks`.
  Tables and stacked images carry no label, so are never captioned.
- Wired into `processFormatting` **last** (after the AI passes, runs whether or not AI is on),
  so a Step-D heading promotion can never clobber a caption.
- Spec: new `## 11. Image captions` + a Step-checklist line in `specs/abnt.md`.
- Tests: `captions.test.ts` (8, incl. negative/label-variant cases) + a `Caption` assertion in
  `rewriteStyles.test.ts`; updated the `loadGuideline` `toEqual` snapshot. Suite **94 passing**, `tsc` clean.
- **Open:** no test fixture has an image yet — extend `test_assets/buildFixture.mjs` with an
  image-bearing paragraph (caption above, `Fonte:` below) to confirm end-to-end on a real `.docx`.

### 2026-06-13 (later 2) — Preview list-numbering fix (CSS counter collision)

A Google-Docs-exported `.docx` with a numbered list rendered every item as "1" in the
**project detail viewer** (`ProjectDetailPage` docx-preview), while the actual file was
correct (verified: valid `numPr` + `numbering.xml` + rels + content-types; renders 1–6 in
Google Docs / Word). Root cause was **not** the pipeline: docx-preview emits its
list-numbering `counter-reset` on `.docx-wrapper`, and the app's `DOCX_PAGE_STYLES` (page
numbering) also set `counter-reset: docx-page` on `.docx-wrapper`. `counter-reset` is a
single non-merging property, and the app's override `<style>` is appended *after*
docx-preview's, so it won the cascade and wiped the list counters → every item reset to 1.
The lauda preview (`PageSelectionPage`) was unaffected because it never sets a counter on
`.docx-wrapper`. Fix: reset `docx-page` on the body container (`.docx-body`, a class added
to the `bodyRef` div) instead of on `.docx-wrapper`, removing the collision. Verified
fixed on the dev session — the list renders 1–6 in the project viewer.

### 2026-06-13 (later) — Step D fixes: list numbering + heading consistency

Two formatting-output bugs reported from a real run, both traced to the Step D AI
heading pass:

- **List numbering destroyed (all items restarted at "1").** The model was promoting
  numbered list items to headings because the descriptor it sees had no list signal —
  `"1. Lorem ipsum"` is indistinguishable from a numbered heading `"1. Introdução"` by
  text alone. Promoting a list item swaps its `<w:pStyle>` but leaves `<w:numPr>` in
  place, breaking the list's numbering continuity. Fixed in three layers: `isListItem()`
  added to `blocks.ts` (+ a `listItem` flag on `BlockDescriptor`); `chunkHeadings`
  excludes list items as candidates; `applyHeadingDecisions` refuses to promote a list
  item even if a decision says so; and the prompt states `listItem: true` is always
  `body`. List paragraphs are now never touched.
- **One of several identical sibling headings jumped a level.** The chunker tags the
  first non-empty paragraph on each page `atPageStart`, and the prompt called that "a
  strong sign of an h1" — so a sibling that happened to fall at a page top got bumped
  above its peers. Prompt-only fix: demoted `atPageStart` to "weak signal only — never
  override numbering, wording, or sibling consistency," and added a "treat parallel
  headings identically" rule (same numbering depth + case + boldness + parallel wording
  ⇒ same level, regardless of page position or chunk boundary).
- Tests: 2 new regression tests in `stepD.test.ts` (list items excluded as candidates;
  a list item is never promoted even on an explicit decision). Formatting suite green
  (83 passing, 2 evals skipped), `tsc` clean.
- **Operational:** the prompt body lives in `prompts/heading-classification.md` and is
  read at runtime — restart the server (or rebuild for the deterministic changes) so the
  new behaviour takes effect on the next job.
- **Timing logs added** to `processFormatting.ts`: a "calling model …" line before each AI
  call (Step C and Step D, with the model slug), the elapsed time for each pass, and a
  total per-document time on the final `done:` line (and on the `FAILED:` line). Lets you
  see how long each document — and each AI call — takes from the server console.

### 2026-06-13 — Lauda-based billing migration

**Billing unit switched from pages to laudas (~300-word units):**
- New `web/src/lib/laudas.ts` — `computeLaudas` (word-boundary segmentation), `laudaBlockSet`
  (lauda numbers → block index set for slicing), `getLaudas` (file → Lauda[]).
- `web/src/lib/docx-slice.ts` rebuilt: exports `getDocxBlocks` (canonical body block list) and
  `sliceDocxByLaudas(file, Set<blockIdx>)`; old 40-block virtual-page `sliceDocx` removed.
- `web/src/lib/pdf-slice.ts` deleted — PDF no longer accepted as input. Only `.docx` supported.
- `GetStartedPage` counts laudas (not pages) after file selection; `.docx`-only validation.
- `PageSelectionPage` rebuilt: continuous `docx-preview` render with in-flow dashed "Lauda N"
  dividers (same word boundaries as slicing); lauda checklist with word count per lauda; selected
  laudas dim in the live preview via `.lauda-disabled` class. Page-grid UI is gone.
- `CheckoutPage` slices the file with `sliceDocxByLaudas` before upload; `pageCount` in state
  now means selected lauda count. References stay inline (sentinel `[0]` for auto-detect).
- `ProjectDetailPage` shows `laudas.totalLaudas` label for `.docx` projects.
- All three locales updated with `laudas` namespace (title, tip, dividerLabel, wordCount, etc.).
- **Still open:** `laudas.ts` is untracked; `/pg` suffix in GetStartedPage cards (lines 242, 318)
  should say `/lauda`.

### 2026-06-09 — PageSelection reference badge + URL fetch bug fix

**Reference page visual feedback (`PageSelectionPage.tsx`):**
- Each page thumbnail now derives two booleans: `isRefPage` (`parsedRefPages.has(page)`) and `isSelectedRef` (`isSelected && isRefPage`).
- Selected + ref: circular checkbox replaced by an amber pill badge (`bg-amber-50 text-amber-700 border border-amber-200`, Check icon size 10 + "Referência"/"Reference" label); card border and shadow ring switch to amber tones.
- Unselected + ref: circle keeps its shape but gains an amber-600 border (no fill, no icon).
- All other pages: unchanged green/forest treatment.
- Same badge logic added to the **lightbox expanded view** header. Header order: amber circle checkbox → "Page X / Y" → ref badge (badge only when selected + ref; checkbox fills amber when selected + ref, amber border when unselected + ref).
- Added `pageSelection.refBadge` i18n key to all three locale files: `"Reference"` (en), `"Referência"` (pt-BR, pt-PT).

**URL fetch flash bug (`GetStartedPage.tsx`):**
- `setFetchingLink(false)` was called on the success path before `navigate()`, causing React to re-render the input for a tick before navigation, making it look broken.
- Fix: removed the success-path reset. `fetchingLink` now stays `true` until the component unmounts on navigation. Error/early-return paths still reset it correctly. No stale-state risk — `fetchingLink` is local `useState` that re-initialises to `false` on every mount.

### 2026-06-08 (later 2) — Step C prompt fix: free model now works
- Symptom: live Step C returned **0 emphasis** on every reference (free `gpt-oss-120b:free`).
- Isolated it by probing the model directly with three prompts: (a) real assembled pipeline
  prompt → 0 emphasis; (b) a crisp hand-written prompt with markdown output → perfect;
  (c) crisp prompt with the **same JSON-segments output** → perfect. Conclusion: not the
  model, not the JSON format — the **`reference-reformatting.md` prompt content** was the bug.
- Rewrote the prompt: front-loaded an explicit per-source-type emphasis map (book→title,
  article→periodical name, chapter→book title, website/thesis→title), added a middle-emphasis
  journal-article worked example, banned markdown chars inside `text`, and demoted the
  "return unchanged" escape hatch to a genuine last resort. Re-probed the real assembled
  prompt → free model now emphasises all entries correctly.
- Hardened `ai/referencesDecider.ts`: `emphasis` is now `.nullish()` and coerced to undefined
  (weak models occasionally send `null`, which previously would fail zod and drop the chunk).
- Added per-entry Step C logging (`logReferences`) + clearer "why nothing happened" diagnostics
  in `processFormatting.ts` (no page flagged vs flagged-but-not-located vs ran).
- Open: confirm one real upload renders bold in the `.docx`; decide author-surname casing
  (spec says standard `Sobrenome, Nome`, but many institutions expect UPPERCASE — the free
  model is inconsistent here, so the choice matters).

### 2026-06-08 (later) — Step C built (AI reference reformatting)
- Built **Step C**, mirroring Step D's model-agnostic seam:
  - `stepC.ts` — `chunkReferences` (packs the region's entry paragraphs under the char
    budget; each entry independent, no cross-chunk context), `applyReferenceDecisions`
    (renders `segments` → `<w:r>` runs, splices over each entry by absolute index,
    keeping Step B's `<w:pPr>`), and the `stepC` orchestrator. Empty/missing segments →
    entry left unchanged (conservative).
  - `ai/referencesDecider.ts` — real OpenRouter decider (`generateObject` + zod), reading
    spec §6 (rules) + §7 (examples); reuses `headingDecider`'s generic `repairDecisions`.
  - `ai/referencesPrompt.ts` + `prompts/reference-reformatting.md` — prompt assembly + body.
  - Wired into `processFormatting.ts`: A → B → **C** → D, both AI passes share the located
    `region` and each is independently try/caught (an AI failure keeps the deterministic result).
  - Tests: `stepC.test.ts` (14, all green) + gated `stepC.eval.test.ts`. A unit test caught a
    real bug — the opening-`<w:p>` regex also matched self-closed `<w:p/>`; fixed.
- Server suite now **77 passing**. `tsc` green. No web changes.
- Updated `docs/formatting-pipeline.md` (build status, Step C description, key-files table) and
  noted the merge of `refactor/codebase-cleanup` into `main`.

### 2026-06-08 — codebase refactor + Step D fix
A full senior-level cleanup pass (branch `refactor/codebase-cleanup`, 11 commits):
- Git hygiene: untracked build cache, agent worktrees, and local settings; added ignore rules.
- Docs: made shadcn/ui official, condensed two n8n-era plans into `docs/formatting-pipeline.md`,
  deleted stale generated docs, replaced the boilerplate web README.
- Dead code/deps: removed `TextExtractPage`, `App.css`, `n8nResources/`, the unused `lib/extract.ts`,
  and the `mammoth`/`tesseract.js`/`pdf-text-extract` dependencies.
- **Fixed the broken web production build** (8 pre-existing type errors, incl. a latent `pageCount`
  crash and pdfjs v5 API drift).
- Removed the legacy `references_file_path` path; **the DB column was dropped** (`ALTER TABLE`).
- Stood up the web test harness and added 32 tests.
- Unified the project status enum on the backend vocabulary (`pending`/`processing`/`complete`).
- Performance: code-split the heavy routes — initial bundle **1.7 MB → 454 kB**.
- **Step D fix:** it had silently stopped because a stale `dist/` (pre–Step-D, June 2) was being
  run. Rebuilt `dist`; verified Step D works live. No code change — operational only.
