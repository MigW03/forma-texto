# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below, not here.

**Last updated:** 2026-06-17

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
- **Tests:** server **179** passing (3 AI evals skipped); web **32** passing.
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
  (Step D/C) with `AI_PROOFREAD_MODEL=nemotron-3-nano-30b-a3b:free` (Step P)** — strong model where
  it matters (headings), light/fast where it may not (proofreading). `AI_MAX_TOKENS=8192` and
  `AI_MAX_CHARS_PER_CHUNK=3000` — reasoning models need the larger token budget or JSON truncates
  mid-response. **Step P has its own token budget** `AI_PROOFREAD_MAX_TOKENS` (default 4096) so
  proofreading generations are shorter (faster, fewer mid-stream resets) without starving Step C/D.
  **Watch nano on Step P:** it's small (30B/3B active) — if proofreading starts introducing or
  missing pt-BR grammar/citation fixes, bump it up a tier.
- **Free models drop the socket mid-response** (`ECONNRESET`/"terminated", `200` then body killed).
  The AI SDK marks these `isRetryable:false`, so `ai/retry.ts` (`withConnectionRetry`) wraps all
  three deciders' `generateObject` calls and retries only transport resets (backoff + jitter; reuses
  `AI_MAX_RETRIES`). HTTP-status retries stay the SDK's job.
- **OpenRouter free tier = 50 requests/day, account-wide** (`429 "Rate limit exceeded:
  free-models-per-day"`). Once exhausted, **every** AI pass (Step C/D/P) fails until the daily
  reset — all are non-fatal, so the job still finishes (deterministic formatting + placeholders
  run), but the doc gets no AI heading/reference/proofreading work. Add credits to OpenRouter
  (unlocks 1000/day) or wait for reset. This does **not** affect `/fill-content` (no AI there).
- **All model-authored text is sanitized before it touches XML.** A stray NUL byte from the model
  once corrupted a Step C reference splice and made the whole `document.xml` unparseable (viewer went
  blank). `formatting/xmlText.ts` `escapeXml` now strips XML-1.0-illegal control chars before escaping;
  used by `stepC.ts` and `runs.ts`.
- **Gated live evals** for the AI path (no spend in CI), e.g. for Step D:
  `cd server && set -a; . ./.env; set +a; RUN_AI_EVALS=1 npx vitest run src/lib/formatting/stepD.eval.test.ts`.
  Step C has a sibling `stepC.eval.test.ts`, but its fixture page flags (`refInput`) are a
  **guess** — point `selectedPages`/`referencePages` at the real references page of
  `test_assets/formatting_test_input.docx` (or a doc that has one) or it self-skips.
- Some `.md` files under `server/src/lib/formatting/` are **live code inputs**, not docs:
  `specs/abnt.md` is parsed at runtime and `prompts/heading-classification.md` is the Step D
  prompt. Don't "simplify" them casually.

---

## Pipeline state additions (caption placeholders)

- **`detectAndInsertPlaceholders`** (`missingInputs.ts`) — runs after `formatCaptions()`. For every image/table block, checks caption slot (i-1) and source slot (i+1). If the neighbour has neither Caption style nor matching label text, inserts a red `<w:p>` placeholder (Caption style + `FF0000` color) at the correct position. Returns the modified XML + `PendingInput[]` (id, kind, ordinal, insertedAt). 18 unit tests.
- **`needs_input` status** — if any placeholders were inserted, pipeline stamps `status: 'needs_input'`, stores `pending_inputs: PendingInput[]` on the project row, and skips the ready email. When all slots are resolved, stamps `complete` and sends the email.
- **`POST /api/processing/fill-content`** — accepts `{ projectId, fills?, removals? }`. Downloads/transforms/re-uploads the processed DOCX; stamps `removed_inputs` (audit trail); flips to `complete` when no pending slots remain.
- **`removeContent` behaviour** — when a user removes a caption/source, `removeContent` sets the block replacement to `''` (empty string), which causes `replaceBlocks` to **fully delete** the placeholder `<w:p>` from the XML. No empty paragraph is left behind. The test suite verifies this via block-count before/after.
- **Frontend** — `needs_input` badge (orange), query includes `pending_inputs`, viewer opens the processed file in read-only mode, floating red-border input overlays appear aligned with each placeholder text node in the DocxViewer, each overlay has save + remove (with confirmation modal).
- **DB columns needed** (run in Supabase console before deploying):
  ```sql
  ALTER TABLE projects ADD COLUMN pending_inputs  jsonb;
  ALTER TABLE projects ADD COLUMN removed_inputs  jsonb;
  ```

---

## Open work / next steps

- [x] ~~**Confirm Step C live**~~ — **confirmed 2026-06-17**. Bold renders correctly in the output `.docx`.
- [ ] **Live end-to-end `needs_input` fill/save verification** — reprocess a fresh doc with a missing figure/table caption, then: (a) fill an input and confirm saved text appears in the downloaded file; (b) remove a placeholder and confirm it's gone from the download; (c) fill the last slot → project flips to `complete`, download unlocks; (d) disconnect the server mid-save → red `saveError` banner appears with the HTTP status. Use a **freshly reprocessed** doc (files processed before 2026-06-17 may still be cached up to 1h). Also confirm the error banner is clear + dismissible when OpenRouter is rate-limited (fill/remove are AI-free, so they should succeed regardless).
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

### 2026-06-17 (later 2) — Surface background fill/remove failures

Background saves were silently swallowed — a failed write would just revert (reconcile) with no explanation, appearing to the user as "input not saving."

- `callFillApi` now includes the HTTP status in the thrown error (`${res.status} ${d.error ?? res.statusText}`).
- `runInBackground` stores the error message in new `saveError: string | null` state, cleared on the next save attempt.
- Dismissible red banner in the viewer top bar shows `project.fillIn.saveError` ("Não foi possível salvar — tente novamente") when `saveError && bgSaving === 0`, so the user knows to retry.
- `project.fillIn.saveError` key added to all 3 locales.
- Root cause of the reported "input not saving" was almost certainly the **OpenRouter free-tier 429** (`free-models-per-day` exhausted — 50 req/day account-wide). `/fill-content` uses no AI, so it's unaffected once the quota resets or credits are added; the banner now makes any other failure reason immediately visible.
- Server 179 passing, web 32 passing, tsc clean, production build green.
- **Next session:** live end-to-end verify (see Open work above).

### 2026-06-17 (later) — Image layout + needs_input UX polish

Three improvements requested after the first interactive-input run.

- **Inline image sizing & centering (server).** Word kept the source doc's absolute
  image dimensions, so figures came in oversized. New deterministic `imageLayout.ts` →
  `formatImages(documentXml, guideline)` scales every `<wp:inline>` image to 70% of the
  page content width (`IMAGE_WIDTH_FRACTION`, aspect ratio preserved) and centers its
  paragraph. Content width = `<w:pgSz>` width − guideline margins, in EMU (635 EMU/twip);
  reads the primary `<wp:extent>`, computes one scale factor, applies it to every `cx`/`cy`
  in the drawing. Floating `<wp:anchor>` images are left alone. Wired into `processFormatting`
  first in the final-touches block (before `formatCaptions`). 8 unit tests. **No image in the
  test fixture yet — live confirmation still pending** (same gap as captions).
- **Overlay placement (frontend).** The fill-in inputs overlapped the page at higher zoom.
  `scanPlaceholders` now anchors them in the right gutter outside the page (`.docx-wrapper`
  right edge + 12px, scroll-adjusted) instead of `right: 12`.
- **needs_input load/interaction speed (frontend).** Filling an input used to re-render the
  whole document twice over: `refreshProcessedUrl` swapped the signed URL, and the realtime
  UPDATE re-signed it again — each change to a stable file forced a full `docx-preview`
  re-render. Now save/remove patch the rendered DOM in place (`placeholderEls` ref: replace
  the red run's text + drop its color on fill; remove the closest `<p>` on remove), and the
  realtime handler skips re-signing when `processed_file_path` is unchanged (`signedProcPathRef`).
  `refreshProcessedUrl` removed.
- **needs_input email (server).** When the pipeline stamps `needs_input`, it now emails the
  user (same shape as the ready email) pointing them to fill in the missing captions/sources.
  `sendProjectNeedsInputEmail` in `notify.ts` + template `emails/projectNeedsInput.ts`, called
  non-fatally from `processFormatting` step 7. Fires only on first entry into `needs_input`;
  the ready email still fires when the final slot is resolved.
- **Fix — stale processed file after fill/remove (server + frontend).** Removing a caption
  cleared the UI but the exported file kept the red placeholder and a reload brought it back.
  Cause: the `needs_input` file is overwritten by `/fill-content`, but it was uploaded with
  the default `cacheControl` (1h, keyed by path) and the client reused the **same signed URL**,
  so download + reload fetched a **stale CDN copy** (the CDN keys by path, ignoring the token).
  Fixes: both processed-file uploads now use `cacheControl: '0'`; **every processed signed URL is
  cache-busted** (`bustCache` appends `&_cb=<ts>`) at all sign sites so a fetch can't resolve to a
  stale copy; the frontend **reconciles** (re-fetch + re-sign) once the background queue drains on
  completion/error; download is gated on `bgSaving === 0`. **Note:** files uploaded BEFORE this
  change are still cached for up to 1h — reprocess a doc fresh to test. **Caveat:** `/fill-content`
  doesn't regenerate the PDF export, so a completed-via-input project's `.pdf` is stale — harmless
  now (LibreOffice not installed) but fix before PDF export ships.
- **Fix — final-download button clickable in needs_input (frontend).** `<Button asChild disabled>`
  is a no-op on an `<a>`; now a real disabled `<button>` renders until the project is `complete`
  and not mid-save (`downloadLockedHint` tooltip, 3 locales).
- **Fix — stale `insertedAt` after a removal (server).** A removal deletes a block, shifting
  every later pending input's index up by one, but the endpoint kept the survivors' original
  indices — so a second fill/remove on a multi-figure doc hit the wrong block. New
  `shiftPendingAfterRemovals` recomputes survivor indices; `fill-content` applies it before
  persisting `pending_inputs`. 4 tests. Single-placeholder docs were unaffected.
- **Background fill/remove saves (frontend).** The `fill-content` server round-trip (download →
  re-zip → re-upload the whole DOCX) no longer blocks the UI. `handleSave`/`handleRemoveConfirm`
  apply the change optimistically (DOM + state + dismiss the overlay/modal instantly) and push
  the API call onto a **serial queue** (`saveQueue` ref) — must be serial, since each call
  reads-modifies-writes the same file and concurrent writes would clobber each other. A
  "Salvando alterações…" pill shows while writes are in flight (`bgSaving`); a failed write
  self-heals via `reloadProject`. New key `project.fillIn.savingBackground` (3 locales).
- **Stale test fixed.** `web/src/lib/status.test.ts` predated the `needs_input` badge variant
  and was failing; updated to include it.
- Server suite **175 passing**, web **32 passing**, both `tsc` clean, web build green.

### 2026-06-17 — Interactive content completion (caption placeholders)

Full `needs_input` lifecycle for missing ABNT captions and source lines on figures and tables.

- **`server/src/lib/formatting/missingInputs.ts`** (new) — `detectAndInsertPlaceholders`, `fillContent`, `removeContent`. Walks image/table anchors, checks i-1 and i+1 slots, inserts red Caption-style placeholder paragraphs for absent slots and applies Caption style to existing-but-unstyled neighbours without inserting pending entries. `insertedAt` tracks block index in stored processed DOCX. 18 unit tests.
- **`server/src/lib/formatting/captions.ts`** — exported `isImageParagraph`, `FIGURE_LABEL_RE`, `SOURCE_LABEL_RE` so `missingInputs.ts` can import them.
- **`server/src/lib/formatting/index.ts`** — re-exported new types/functions.
- **`server/src/lib/processFormatting.ts`** — `pending` scoped before `if (doFormatting)`, `detectAndInsertPlaceholders` called after `formatCaptions`, step 7 branches on `pending.length`: → `needs_input + pending_inputs` (no email) or → `complete + pending_inputs: null` (+ email).
- **`server/src/routes/processing.ts`** — `POST /api/processing/fill-content` endpoint with `authorize()` reuse, partial-fill support, `removed_inputs` audit trail, `complete` flip when all resolved.
- **Frontend:** `status.ts` adds `needs_input` type + `normalizeStatus`; `badge.tsx` adds orange variant; `DashboardPage.tsx` includes `needs_input` in active count; `ProjectDetailPage.tsx` queries `pending_inputs`, gates download (preview OK, download only on `complete`), floating overlays in DocxViewer (inside scroll container, aligned with placeholder text via `getBoundingClientRect`), per-input save + remove buttons, confirmation modal with `createPortal`; three locale files updated with `dashboard.status.needs_input` and `project.fillIn.*` keys.
- **`supabase_tables.md`** — documented `pending_inputs` and `removed_inputs` columns + SQL.
- **DB migration required before deploying:** `ALTER TABLE projects ADD COLUMN pending_inputs jsonb; ALTER TABLE projects ADD COLUMN removed_inputs jsonb;`
- **`removeContent` correction (end of session):** originally set the removed block to `'<w:p/>'` (left an empty paragraph). Changed to `''` so `replaceBlocks` deletes the block entirely — no empty paragraph remains in the final file. Related test updated (`'removes the placeholder block entirely'`, checks `blockCount - 1` and no `[inserir legenda]` text; untargeted-placeholder test updated to use `toContain` instead of stale `insertedAt` index).
- Server suite **167 passing**, `tsc` clean both sides.

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
