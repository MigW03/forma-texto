# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a short dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below and in `git log`, not here.

**Last updated:** 2026-07-16

---

## What this is

FormaTexto — an AI-powered academic document formatting and proofreading service
(Brazil-first, ABNT). Users upload a `.docx`/`.pdf`, pick services and pages, pay,
and the backend formats/corrects the file with a multi-model AI pipeline.

Deeper docs (keep these as the real source of truth):
- [`CLAUDE.md`](CLAUDE.md) — architecture, design system, routes, conventions.
- [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md) — the DOCX formatting pipeline.
- [`PLAN.md`](PLAN.md) — open feature/task checklist.
- [`supabase_tables.md`](supabase_tables.md) — database schema.

## Layout

- `web/` — React 19 + Vite + TypeScript frontend (shadcn/ui, Supabase, Stripe, i18next).
- `server/` — Express + TypeScript backend (Stripe, Supabase service-role, email, the formatting pipeline).
- `docs/`, `business_decisions/` — documentation and decision records.

---

## Current status

- **Branch:** `fable-fixes`.
- **Build:** web production build **currently broken** — `npm run build` (`tsc -b`) fails on two
  pre-existing unused variables in `ProjectDetailPage.tsx` (unrelated to recent sessions; last verified
  green 2026-06-17). `tsc --noEmit` (looser config) is clean. Small cleanup needed.
- **Tests:** server **443** passing (3 AI evals skipped); web **49** passing.
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer, the DOCX
  formatting pipeline Steps A/B/C/D (both AI passes: reference reformatting + headings), pré-textual
  detection + formatting + sumário generation with real page numbers, ABNT header page numbering (NBR
  14724), and the server-side proofreading pass (Step P).
- **Key features:** billing unit = lauda (~300 words); DOCX input only; full pré-textual element
  handling (capa/folha de rosto/resumo/etc detection, vertical center + city/year pinned to the page
  foot on both covers, section page breaks, 3-zone capa layout); caption detection with gap tolerance +
  embedded splitting; sumário TOC generation from detected headings with real page numbers (LibreOffice
  render pass, the pipeline's last step); ABNT-compliant header page numbering (hidden through the
  pré-textual region, visible from Introdução onward, capa excluded from the count); appendix exclusion
  from billing (but included in output); image sizing on overflow; AI-powered heading classification +
  reference reformatting + grammar proofreading — all three AI passes with split-retry + escalated-retry
  resilience.

## Pipeline state (formatting)

Full breakdown: [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md). Summary:

- **Step A** (deterministic styles/overrides/margins) — built, tested.
- **Step B** (deterministic references layout) — built, tested.
- **Step C** (AI reference reformatting) — built, tested, confirmed live. Behind `AI_FORMATTING_ENABLED`.
- **Step D** (AI heading reclassification) — built, tested, confirmed live.
- **Heading numbering** (ABNT NBR 6024, deterministic) — renumbers every Heading1/2/3 sequentially after Step D, before the sumário rebuild.
- **Sumário generation** (deterministic) — rebuilds the TOC from Heading1–3 after Step D; real page numbers stamped by a LibreOffice render pass as the pipeline's last step.
- **Pré-textual detection/formatting** (deterministic) — capa/folha de rosto/resumo/abstract/sumário/listas/etc. detected and excluded from billing + AI heading classification; 3-zone capa layout (institution top / content center / city-year foot).
- **ABNT page numbering** (NBR 14724, deterministic + render pass) — real OOXML section split at `bodyStart`: pré-textual region gets no header at all (no page number on any of its pages, however many there are); textual part gets a header with a right-aligned `PAGE` field, whose real start value (capa excluded from the count) is resolved by the same LibreOffice render pass that paginates the sumário — the two numbers always agree.
- **Image sizing + captions** (deterministic) — shrinks only on overflow, never enlarges; caption/source detection tolerates blank-line gaps and multi-line captions; appendix/annex images are skipped (not resized/captioned).
- **Long quotations** (deterministic, NBR 10520) — `longQuotes.ts` tags quotes over ~3 lines with the `LongQuote` style (4cm left indent, 10pt, single, justified, marks dropped). Runs before Step A (which strips the author's indent — one of the two detection signals; the other is a wholly-quoted over-long paragraph). Excluded from Step P. Mid-paragraph embedded quotes not yet split.
- **Step Punct** (deterministic punctuation normalization) — runs first in the proofreading service, before Step P.
- **Step P** (AI proofreading) — built, tested, validated live. Char-diff maps AI edits onto runs, preserving other formatting; skips title/references/tables/captions.
- **List indentation, first-H1 page break** (deterministic) — built, tested.
- **Appendix/annex** — detected and frozen (not reformatted/proofread/captioned, not billed) but shipped in the output file untouched.

---

## Operational gotchas (read before debugging)

- **Run the server with `npm run dev`** (ts-node-dev on the source). `npm start` runs the
  compiled `dist/`, which is **gitignored and can go stale**. If you must use `npm start`,
  run `npm run build` first.
- **`server/.env` is loaded once at startup** (`dotenv/config`). After changing it (e.g.
  `AI_FORMATTING_ENABLED`, `AI_PROOFREADING_ENABLED`, `STRIPE_WEBHOOK_SECRET`), **restart the server**.
  The two AI flags are independent: formatting (Steps C/D) and proofreading (Step P) toggle separately.
- **Step D is behind `AI_FORMATTING_ENABLED=true`** and an OpenRouter key. An AI failure is
  **non-fatal by design**: it logs `[processFormatting] … Step D failed (non-fatal …)` and
  keeps the deterministic A/B result. So "no AI headings" can mean the flag is off, the call
  errored, or the doc simply had no plain-text headings to promote (Step D only *promotes*,
  never demotes).
- **AI model — per-step.** `AI_MODEL` is the default; each pass can override it via
  `AI_HEADING_MODEL` (Step D), `AI_REFERENCES_MODEL` (Step C), `AI_PROOFREAD_MODEL` (Step P), each
  falling back to `AI_MODEL` when unset. Current `.env`: ultra for Step D headings, super for Step C
  references, nano for Step P proofreading. **Only Step D actually needs ultra; super is enough for
  Step C.** `AI_MAX_TOKENS`/`AI_MAX_CHARS_PER_CHUNK` control the reasoning-model token budget — too
  small and JSON truncates mid-response. **Never use nano for Step C** — it over-reasons and corrupts
  JSON output (confirmed incident). **Every structured-JSON pass (C/D/P) needs super/ultra; nano is
  unsafe for all of them** (except when running Step P specifically, which is currently on nano and
  stable — the corruption risk was specific to Step C's single-large-batch shape).
- **Free models drop the socket mid-response** (`ECONNRESET`/"terminated"). `ai/retry.ts`
  (`withConnectionRetry`) wraps all three deciders' `generateObject` calls and retries only transport
  resets (backoff + jitter, reuses `AI_MAX_RETRIES`). HTTP-status retries stay the SDK's job.
- **OpenRouter free tier = 50 requests/day, account-wide** (`429 "Rate limit exceeded:
  free-models-per-day"`). A rate limit is now handled distinctly from other AI failures
  (`isRateLimitError`/`RateLimitError` in `ai/retry.ts`): the AI passes **fail fast** on it (no
  split-retry — every retry would 429 too and burn quota), and `processFormatting` **aborts the whole
  job to `pending`** rather than stamping `complete` — so a doc with the AI passes silently skipped
  NEVER ships. Requeued jobs are retried by `POST /api/processing/start` (manual — what to use while
  testing, after the daily reset) or the daily `retry-pending` cron (`sql/retry_pending_cron.sql`,
  capped by `processing_attempts`). Other AI failures (bad JSON, token ceiling) stay non-fatal per
  block and still complete with the deterministic result. Add credits to OpenRouter (unlocks 1000/day)
  to avoid the cap entirely.
- **All model-authored text is sanitized before it touches XML.** `formatting/xmlText.ts`'s `escapeXml`
  strips XML-1.0-illegal control chars before escaping (a stray NUL byte from a model once corrupted a
  splice and made `document.xml` unparseable). `headingDecider.ts`'s `sanitizeControlChars` does the
  same for JSON string values before any parse attempt in `repairDecisions` (shared by Steps C/D).
- **Gated live evals** for the AI path (no spend in CI), e.g. for Step D:
  `cd server && set -a; . ./.env; set +a; RUN_AI_EVALS=1 npx vitest run src/lib/formatting/stepD.eval.test.ts`.
  Step C has a sibling `stepC.eval.test.ts`, but its fixture page flags are a guess — point them at a
  real references page or it self-skips.
- Some `.md` files under `server/src/lib/formatting/` are **live code inputs**, not docs:
  `specs/abnt.md` is parsed at runtime and `prompts/heading-classification.md` is the Step D
  prompt. Don't "simplify" them casually.
- **Stripe webhooks (local dev):** the discounted-checkout path depends entirely on
  `STRIPE_WEBHOOK_SECRET` being set and a listener forwarding events — `stripe listen --forward-to
  localhost:3001/api/webhook` (Stripe CLI) prints the secret to put in `server/.env`. Without it,
  `trial_used_at` never gets stamped for non-1-page orders and the trial discount applies forever. The
  1-page fully-free path (`/complete-free-order`) doesn't depend on the webhook.

---

## Open work / next steps

> MVP launch-readiness assessment (2026-07-17). The quality bar is high: students may submit the output
> as their final project, so a silently-wrong doc is the core risk. Grouped by blocker vs. quality vs.
> trust. Feature-level checklist lives in `PLAN.md`; this section is the launch-critical / cross-cutting
> set.

### Launch blockers (can't ship without)

- [ ] **Web production build is broken.** `npm run build` (`tsc -b`) fails on two pre-existing unused
      vars in `ProjectDetailPage.tsx` (`fileName` in `PreviewError`, `pdfDownloadName`). `tsc --noEmit`
      passes, so it's small — but the frontend can't deploy until it's green.
- [ ] **PDF export has no production home.** LibreOffice is a system binary — not viable on serverless
      (Vercel/Lambda). Use a Docker container (`apt-get install libreoffice-writer fonts-liberation`) or
      a Gotenberg sidecar (would swap `docxToPdf.ts`'s shell-out for a `GOTENBERG_URL` call). No host
      chosen. Export is non-fatal, so prod runs without it, but the PDF is what students actually submit.
- [ ] **Production Stripe webhook.** Local dev works via `stripe listen`; the deployed env needs a real
      webhook endpoint in the Stripe Dashboard with its own `STRIPE_WEBHOOK_SECRET`. Order recording AND
      trial consumption both depend on it. Consider the client-side reconciliation fallback (post-redirect
      `stripe.paymentIntents.retrieve()`, idempotent on `stripe_payment_intent_id`) so it's not the sole
      path — discussed, deferred, not built.
- [ ] **Move off the OpenRouter free tier before real usage.** 50 requests/day account-wide caps you at
      ~2-3 docs/day total (a full thesis is 30-40+ AI calls). Hard scaling wall. Rate-limit handling now
      degrades gracefully (see 2026-07-17 session log) but paid credits (1000/day) are needed for volume.

### Output quality — the "near perfect" bar

- [ ] **Output-validation backstop before stamping `complete`.** Catches the deterministic-bug class
      (the pré-textual/pagination family unit tests keep missing): valid XML, no leftover red
      placeholders, sumário entry count matches heading count, references present when flagged, page-number
      `pgNumType` start resolved (not the `1` placeholder). Route a failure to a review state, don't ship.
      (Complements the rate-limit fail-fast, which catches missing *AI* work.) Full spec in `PLAN.md`.
- [ ] **Operator alerting / error monitoring** (e.g. Sentry). Today a degraded doc only `console.error`s.
      For a low-volume MVP a human backstop — get pinged when a job fails/requeues/degrades — is worth a
      lot while real-doc bugs are still being found.
- [ ] **Audit the pipeline for missing ABNT elements.** Confirmed handled: headings, references,
      captions/images, pré-textuais, pagination, long quotations (citação longa > 3 linhas, `longQuotes.ts`).
      NOT confirmed and common in theses: footnotes, table formatting. Worth a deliberate audit before
      claiming "near perfect."
- [ ] **Pré-textual refinements** — the capa/folha *classification* split is still heuristic (year-line
      based); a field-level detect-and-confirm UI is the eventual fix. See
      `business_decisions/pretextual-elements.html`. **Known bug (reported 2026-07-17):** the ficha
      catalográfica has no pré-textual kind, so it's absorbed into the `folhaDeRosto` section and gets
      centered + vertically distributed (user saw its title centered in the PDF). Fix + full diagnosis in
      `PLAN.md` (Backend / AI Pipeline); anchor it on a real `.docx` next session.

### Trust & recourse (business, not just code)

- [ ] **Refund/redo path.** Students pay for an unseen result on their most important document, and there's
      no mechanism to flag a bad output and get it corrected. Essential for trust given the stakes; consider
      a satisfaction guarantee and/or preview-before-pay.
- [ ] **Email from a verified domain.** Still `onboarding@resend.dev` — reads as untrustworthy for a paid
      service. Verify the domain in Resend and swap the `from` address.

### Deploy steps (when going to production)

- [ ] Run the `processing_attempts` migration (`supabase_tables.md`) and the retry cron
      (`server/sql/retry_pending_cron.sql`). **Leave the retry cron OFF during free-tier testing** — it
      would consume fresh daily quota on old jobs; the manual `POST /api/processing/start` retry is what to
      use while testing.
- [ ] Run `server/sql/cleanup_cron.sql` (file auto-deletion) + its two Vault secrets, once per environment.

### Minor / optional

- [ ] Add tests for the DOCX slicer (`docx-slice.ts`); extend the test fixture with an image to confirm
      `formatCaptions` end-to-end on a real `.docx`.

---

## Session log

> Older entries are compressed to a one-line index — see `git log -p -- HANDOFF.md` for full narrative
> detail on any of them.

### 2026-07-17 — Image overflow/off-center bug (inherited first-line indent)

User reported a freshly-processed real doc: the image was shifted right and overflowed the right margin,
not centered. Root cause: `formatImages`'s `centerParagraph` only ever stamped `<w:jc w:val="center"/>` —
it never zeroed the paragraph's indent. Step A's override-strip removes only DIRECT `<w:ind>`, not the
style cascade, so an image paragraph with no override of its own still inherits `Normal`'s first-line
indent (ABNT 1.25cm, `w:firstLine="709"`). The image is sized to EXACTLY the content width (the overflow
cap), so that inherited shift pushes it right by the indent amount and its already-full-width box
overflows the margin by the same amount. Fix (`imageLayout.ts`): `centerParagraph` now strips any
existing `ind`/`jc` and rebuilds both fresh together (`<w:ind w:left="0" w:right="0" w:firstLine="0"/>`
before `<w:jc w:val="center"/>`, correct CT_PPr order), idempotent. **Verified on the real reported file**
(re-ran current `formatImages`+`formatCaptions` over its actual `document.xml`, rendered via real
LibreOffice): image now flush within the margins, edge-aligned with body text on both sides. 3 new tests.
Server suite 460 (this + the keepNext entry below), `tsc` clean.

### 2026-07-17 — Figure/table captions kept on the same page as the image (keepNext bug)

User: a figure caption sometimes lands on one page while the image is pushed to the next. Root cause: the
caption pass (`captions.ts`) chained the group (label → blank gap → image → source) with
**`<w:keepWithNext/>` — an element that does not exist in WordprocessingML** (the real one is
`<w:keepNext/>`, used correctly in `rewriteStyles` for Title/heading). Renderers silently ignore the
bogus element, so the keep-together had always been a no-op. Also, `addPPrProperty` appends at the END of
`<w:pPr>`, which is out-of-order for `keepNext` (CT_PPr wants it right after `pStyle`, before
`jc`/`spacing`/`ind`) — appending after the image paragraph's `<w:jc w:val="center"/>` would itself be
dropped. Fix: new `addKeepNext` helper (blocks.ts) inserts `<w:keepNext/>` right after `<w:pStyle>` (else
first pPr child), idempotent; `captions.ts` now uses it everywhere (figure label lines, blank gaps, the
image paragraph, table label). **Verified end-to-end with a real LibreOffice render, A/B:** a doc where
the caption lands near the page-1 foot with a ~15cm image renders SPLIT with the old `keepWithNext`
(label p1, image+source p2) and TOGETHER with the fix (label moves to p2 with the image). 2 new caption
tests (incl. schema-order: keepNext before jc). Server suite 460, `tsc` clean. Documented in `abnt.md`
§11. **Limitation:** a table + its source line isn't fully bound yet (only the label-above-table gets
keepNext; keeping a whole table with a following source needs row-level `cantSplit`/keepNext handling).
**Real-doc re-verification saga (same session, later) — the ACTUAL remaining bug, found and fixed.**
The user's next several reprocesses (even after a confirmed clean server restart — checked live process
state via `lsof`/`ps`, single clean PID, correct file mtimes) kept showing the split. Every isolated
repro of `captions.ts` (findCaptionsAbove path, splitEmbeddedCaption path, full pipeline replay including
Step Punct) succeeded — the code was never wrong for the case it was designed for. Root cause, found via
temporary debug logging in a live server run + the user's own correct diagnosis: **the specific image in
the user's doc had NO caption/source anywhere near it in the raw upload** (`findCaptionsAbove` correctly
returned `[]`) — so the project went to `needs_input`, and the user typed the caption/source in through
the app's fill-in UI. That flow (`POST /api/processing/finalize-inputs` → `finalizeInputs` in
`missingInputs.ts`) uses **entirely separate paragraph builders** (`buildPlaceholderXml`/`buildCaptionXml`)
that were never touched by the `keepNext` fix above — they never carried `<w:keepNext/>` at all, and the
finalize route zips straight to `exportPdfBeside` without ever re-running `formatCaptions`. So an
author-provided caption (this session's earlier fix) worked; a user-*filled-in* one never did.

Fix (`missingInputs.ts`): both builders now add `<w:keepNext/>` for `figure_caption`/`table_caption` kinds
(mutually exclusive with the existing `SOURCE_SPACING`, since a source line is always the last item in the
group and a caption is always immediately followed by the image/table it labels) — covers both the RED
placeholder (`needs_input` preview) and the final user-typed text (`finalizeInputs`). Verified end-to-end
by simulating the real `detectAndInsertPlaceholders` → `finalizeInputs` flow and rendering both the old and
fixed output via real LibreOffice: old builders → label page 1, image+source page 2 (**split**, matching
the user's exact report); fixed → all together on page 2. 3 new tests (`missingInputs.test.ts`). Server
suite 463, `tsc` clean. **Lesson:** don't stop at "the pass I already fixed is provably correct" — a
feature can have more than one code path that builds the same-looking output; `needs_input`/finalize is a
second, parallel caption-paragraph construction site that needed the same fix independently.

### 2026-07-17 — Long quotations (ABNT NBR 10520)

New deterministic pass `longQuotes.ts` (`formatLongQuotes`), wired into `processFormatting` just BEFORE
`applyStepA` (must run before the override strip, since the author's own left indent is a detection
signal). Tags long quotes with a new `LongQuote` paragraph style (`rewriteStyles` + guideline `longQuote`
values threaded through `guidelines.ts`/`loadGuideline.ts`; the `abnt.md` §8 machine block already had
`longQuote`): 4cm left indent, 10pt, single spacing, justified, no first-line indent. Two deterministic
signals (either suffices, both require > ~3 lines / 280 chars): (a) author already indented the block
(left ≥ 1000 twips); (b) a wholly-quoted paragraph — those also get their surrounding quotation marks
stripped (leading open + trailing close, inside `<w:t>` only so attribute quotes are safe), preserving a
trailing author-date citation. Long quotes are excluded from Step P proofreading (a quotation must not be
grammar-corrected). Verified end-to-end via a real LibreOffice render (PDF inspected): both an
author-indented quote and an over-long inline quote render as 4cm-indented 10pt blocks, no marks,
citation kept; body text untouched. 11 new tests + loadGuideline test updated; server suite 455, `tsc`
clean. **Limitation (noted in `abnt.md` §9 + PLAN):** a quotation embedded mid-paragraph isn't split into
its own block yet — only standalone quoted/indented paragraphs are converted.

### 2026-07-17 — Sumário entries wrapping in docx-preview → FIXED: `setEntryPageNumber` regex vs the font pass

User: sumário lines wrap onto two lines in the browser preview; PDF fine. **Fixed** (`sumarioPagination.ts`).

Chain of diagnosis (all reproduced against the user's real processed `.docx`): (1) The wrap is a
*symptom* — docx-preview renders a right tab as a `wordSpacing` on the tab span, and with **no page
number after the tab** it fills the tab with a giant fixed word-spacing (~261pt) that overflows the line
and wraps the title (indented H2/H3 wrap first). With numbers present it renders one line, always.
LibreOffice renders the empty tab as plain whitespace, so the PDF looked fine ("PDF correct" = not
wrapped, NOT "has numbers"). (2) So the real bug: the entries had **no page numbers**. LibreOffice is
installed + `SOFFICE_PATH` valid, and re-running the render matched every entry to its body page
(`assignEntryPages` → `[8,9,10,10]`) — so matching wasn't the problem. (3) The actual defect:
`setEntryPageNumber`'s regex hard-coded the tab run as `<w:r><w:tab/></w:r>`, but the **explicit-font
pass runs after `buildSumario` and stamps `<w:rPr><w:rFonts…/></w:rPr>` onto every run, the tab run
included** — so by pagination time it reads `<w:r><w:rPr>…</w:rPr><w:tab/></w:r>`. The regex silently
matched nothing → `applySumarioPageNumbers` stamped **0/N** → blank numbers → wrap.

Fix: the tab-run regex now allows an optional `<w:rPr>`, and the stamped number run reuses that rPr so
the digit inherits the entry font. **Gotcha caught by the new test:** a naive `<w:rPr>[\s\S]*?</w:rPr>`
is lazy but crosses run boundaries — it bound the leading `<w:r>` to the *title* run and duplicated the
title; guarded with `(?:(?!</w:r>)[\s\S])*?`. Verified end-to-end on the user's doc: 4/4 stamped
(display 7/8/9/9), no title duplication, and docx-preview renders every entry on one line (measured
`lines:1`). New regression test (`sumarioPagination.test.ts`, the font-stamped tab-run shape). Server
suite 444, `tsc` clean. Repro harness in this session's scratchpad (`docxrepro/`).

NOTE: an earlier same-session attempt blamed docx-preview point-rounding and widened `TAB_INSET` 10→40 —
wrong, **fully reverted**.

**Second, separate bug — the wrap persisted even AFTER numbers were stamped** (user re-tested). Root-caused
by rendering the user's actual reprocessed `.docx` through an app-faithful harness (zoom 0.9 +
`DOCX_PAGE_STYLES` + the `TAB_STOP_SETTLE_MS` timing): the viewer hid the content div with
`display: loading ? 'none' : undefined` during the load/settle window, but docx-preview's one-shot
tab-stop pass (fires ~500ms after render, inside that window) sizes each right tab by measuring the
paragraph's `getBoundingClientRect()` — and `display:none` zeroes every rect, so it baked a giant tab
word-spacing (~548px vs the correct ~413px) → the page-number column wrapped onto its own line (matches
the screenshot: number alone, left-aligned, entry 4 lines tall).

Fix (`ProjectDetailPage.tsx`): **stop hiding the content div with `display`/`visibility` at all — keep it
in normal flow the whole time; the opaque loading spinner (absolute inset-0) is what hides it.** Content
stays laid out → the tab pass measures real widths → no wrap. Zoom is still held at 1 through the settle
window (that's the separate 2026-07-11 zoom-vs-tab fix). **Gotcha that cost an iteration:** the first
attempt hid via `visibility:hidden` (preserves geometry, so the harness *measured* single-line and I
called it fixed) but it rendered the real viewer BLANK — a `hidden→visible` flip on this large, zoomed
subtree leaves Chrome laid-out-but-not-repainted. Lesson: `getBoundingClientRect` geometry is NOT proof
of paint; verify visually. The no-toggle version has no hidden→visible flip, so no blank. Verified
**visually** (screenshot, not just geometry) in a small-doc harness replicating the full app flow
(spinner → zoom1 → zoom0.9, no toggle): document visible, all four entries single-line, numbers
right-aligned. **Frontend-only — the user does NOT need to reprocess, just reload the viewer.** web
`tsc --noEmit` clean. **User confirmed fixed in the real app.**

### 2026-07-17 — AI silent-degrade fix: rate-limit fail-fast + gate `complete` + retry cron

Closed the biggest launch-quality risk: a rate-limited AI pass (OpenRouter free-tier 50/day) used to be
swallowed like any other per-block failure, so a doc could get *zero* AI heading/reference/proofreading
work and still stamp `complete` + email "ready" — a silently half-processed thesis. Now: `ai/retry.ts`
classifies the 429 as a distinct `RateLimitError` (`isRateLimitError` walks the cause chain — statusCode
429, "free-models-per-day" body, etc.); `withConnectionRetry` never retries it (sticky); the three
resilient drivers (`classifyResilient`/`reformatResilient`/`proofreadResilient`) **fail fast** — rethrow
immediately instead of split-retrying calls that would all 429; and `processFormatting` rethrows a
rate-limit out of each AI pass to its outer catch, which **aborts the job to `pending`** (no partial
upload, no `complete`, no email) and logs it as an expected requeue, not an error. Non-rate-limit AI
failures stay non-fatal per block as before. Retry paths: manual `POST /api/processing/start` (bypasses
the cap — use this while testing, after the daily reset) and a new daily `retry-pending` cron
(`retryPendingJobs.ts` + `/api/maintenance/retry-pending` + `sql/retry_pending_cron.sql`, daily at 00:30
UTC just after the free-tier reset, capped by a new `processing_attempts` column). 18 new tests
(isRateLimitError, fail-fast in all three passes, retryPendingJobs). Server suite 443. `tsc` clean.
**Deploy step:** run the `processing_attempts` migration (supabase_tables.md) + the retry cron SQL when
going to production; leave the cron OFF during free-tier testing so it doesn't consume fresh daily quota
on old jobs. This is the same code path that becomes the production safeguard once on paid tier.

### 2026-07-16 — ABNT header page numbering (NBR 14724)

Implemented the page-numbering item flagged the prior session. Researched the actual NBR 14724 rule
first (web search, cross-checked two sources): every sheet from the folha de rosto onward counts toward
the total page count, but the printed number stays hidden through the whole pré-textual region —
visible only from the first page of the textual part (Introdução) onward, continuing the count; the
capa is external to the count entirely (excluded, not just unnumbered). Position: upper right, 2cm from
the top edge, same font as body at 10pt (already specced in `abnt.md`), no decoration.

**Design.** The old `suppressCoverPageNumber` (`<w:titlePg/>` on the document's one section) could only
ever blank a section's own FIRST page, so folha de rosto/resumo/sumário kept showing a number — deleted
and replaced with a real OOXML section split at `bodyStart` (new `pageNumbering.ts`,
`applyAbntPageNumbering`): the pré-textual region becomes its own section referencing an EMPTY header
AND footer (nothing prints, any number of pages), the textual region keeps the document's own final
section — its existing header/footer/titlePg/pgNumType stripped and replaced with a clean number-only
header part (`word/headerN.xml`, wired into `[Content_Types].xml` + `document.xml.rels`) plus an
explicit `pgNumType`, while its `cols`/`docGrid`/geometry are preserved. The correct `pgNumType` start
value isn't knowable until the document is rendered (DOCX has no page metadata) — a placeholder (`1`)
is stamped first, then resolved by `paginateSumario.ts` in the same LibreOffice render pass that already
paginates the sumário, using a new `findBodyStartPage` and `abntCapaOffset`. The sumário's own TOC
numbers get the same offset subtracted, so they always agree with the printed header.

**Three real bugs caught only by rendering through actual LibreOffice** (not the unit suite): (1) a
non-greedy regex swapping the final `<w:sectPr>` matched across the *entire* document when the inserted
front-section sectPr was textually identical to the original — fixed by swapping the final sectPr first.
(2) `<w:headerReference r:id="…">` needs `xmlns:r` on the root `<w:document>`; every prior pass only ever
*read* an existing `r:id`, so nothing had needed to declare it — even the project's own test fixture
lacked it, and LibreOffice silently failed the whole conversion (`source file could not be loaded`)
without it (`ensureRNamespace`). (3) **The user tested a real document and page numbers still showed on
every page** — the idempotency guard bailed the instant it saw ANY `<w:headerReference>` on the final
sectPr, but a real upload almost always ALREADY carries one (an inherited template/Google-Docs header
with a `PAGE` field — the exact case the old `suppressCoverPageNumber` existed for), so the whole pass
short-circuited and did nothing. My synthetic fixture had no pre-existing header, so it never tripped —
classic works-on-fixture/fails-on-real. Fixed: the guard now keys on a section break already at the
boundary (not on any header); the body sectPr is modified IN PLACE (existing header/footer refs
stripped, ours injected, `cols`/`docGrid` preserved) instead of rebuilt from scratch; and the front
section uses EXPLICIT empty header+footer references so it overrides a document-wide header rather than
relying on inheritance.

Verified end-to-end against a real LibreOffice render using a fixture that REPLICATES the real-doc
condition — a document that already ships with a document-wide `PAGE`-field header + `cols`/`docGrid`
(the missing test case). Rendered PDF page images inspected: capa, folha de rosto, resumo+sumário show
no header number; Introdução shows "3" (physical page 4 minus 1 for the excluded capa), matching the
sumário's own TOC entries. 23 new tests (`pageNumbering.test.ts` incl. the pre-existing-header case,
extended `sumarioPagination.test.ts`). Server suite 422 passing (was 406). `tsc` clean. Documented in
`abnt.md` §1/§9 and `docs/formatting-pipeline.md`.

**Real-doc follow-ups (user tested on their document):** (a) page numbers still showed everywhere — the
idempotency-guard bug above, fixed. (b) After that, the SUMÁRIO title landed on its own page with the
entries pushed to the next. Root cause: the section break was placed at `bodyStart-1`, but the
`detectPretextual` re-run at numbering time lands `bodyStart` on the FIRST TOC entry — the sumário's own
numbered entries ("1 INTRODUÇÃO") pass `isBodyHeading` (same false-positive family as the 2026-07-15
"Introdução deletion" bug) — so the break fell right after the SUMÁRIO label, between it and its entries.
Fixed with `bodyStartForPageNumbering` (`sumarioPagination.ts`): anchors `bodyStart` past the sumário's
structurally-identified entry run (`findSumarioEntries`, which keys on the `buildTocEntry` signature, not
on heading-looking text). Verified via a real LibreOffice render with NUMBERED headings (the triggering
condition my earlier fixture lacked) — SUMÁRIO + all entries now render together on one page. Server
suite 425 passing. **User confirmed pagination itself works; awaiting confirmation on the sumário fix.**

### 2026-07-15 — trial-discount webhook fix (local dev) + unnumbered "Introdução" deletion bug

**Trial discount applying on every project.** Root cause: `STRIPE_WEBHOOK_SECRET` was unset in
`server/.env`, so `webhook.ts` bailed out on every event (500, "Webhook secret not configured") —
`trial_used_at` never got stamped for any non-1-page (discounted, not free) order, so
`isTrialEligible` kept returning `true` forever. Only the 1-page fully-free path
(`/complete-free-order`) is self-contained; the discounted path depends entirely on the webhook
landing. Fixed locally: installed the Stripe CLI (`brew install stripe/stripe-cli/stripe`), ran
`stripe listen --forward-to localhost:3001/api/webhook` in the background, and wrote the printed
`whsec_...` into `server/.env`. **Not yet fixed for production** — the deployed webhook endpoint
needs its own secret from the Stripe Dashboard. Discussed a client-side reconciliation fallback
(direct `paymentIntents.retrieve()` after redirect) as a more robust long-term design — deferred.

**Introduction text silently deleted on a short (2-lauda) test upload.** `isBodyHeading()`
(`preTextual.ts` + web's `pretextual.ts`) only recognized a body heading with a *literal* leading
digit ("1 INTRODUÇÃO"). When the author's "Introdução" heading carries no literal number — either not
yet numbered, or numbered only via Word's `<w:numPr>` multilevel-list numbering, which never appears
in `<w:t>` text — `classifyPretextual`'s forward scan for `bodyStart` skipped past it and locked onto
the next line that merely *looked* numbered, dragging `bodyStart` past the real heading. The `sumario`
pré-textual section's `blockEnd` then swallowed the "Introdução" heading and body paragraphs before the
false match, and `buildSumario` (`sumario.ts`) deleted that whole range while rebuilding the TOC. Same
family of bug as the 2026-06-29 `^introdu[çc][ãa]o$` special case, reverted back then because it fired
on manually-typed, unpaginated TOC entries reading bare "Introdução" too.

**Fix — context-aware, not text-only.** Added `isIntroducaoWord` (bare "Introdução" match) +
`looksLikeBodyProse` (the *next* non-blank line must read like an actual paragraph — long and/or ends
in sentence punctuation, not a short ALL-CAPS chapter-title-style line) to both `preTextual.ts` and
`pretextual.ts`, used alongside the existing numeric `isBodyHeading` check. Distinguishes the real
heading (followed by real prose) from a same-text TOC entry (followed by another short chapter-name
line or nothing) — avoiding the exact regression that got the old special case reverted. 6 new
regression tests. Server suite 406 passing (was 402), web 49 passing (was 46). `tsc` clean on both.
**Also logged, not investigated/fixed:** page numbering doesn't follow ABNT NBR 14724 (see Open work).

### Earlier sessions (index only — see `git log -p -- HANDOFF.md`)

- 2026-07-11 (7 entries, same day) — capa/folha pagination bug saga on a real 25MB thesis: a nested
  `<w:sdt>`/`<w:tbl>` parsing fix in `blocks.ts` (`getBlocks`/`replaceBlocks` rebuilt on a depth-tracked
  scan), a blank-run page-boundary heuristic added then fully removed after it split a single-page capa
  across 3 pages (ABNT violation), a `docx-preview` zoom/tab-stop bug root-caused and fixed (sumário page
  numbers rendering blank/wrapped in the browser only, PDF was always correct), and the true 3-zone capa
  layout (`detectHeader` pins the institution name to the top) + `suppressCoverPageNumber`. **User
  directive, still binding:** "we finally have the city and date in the bottom of the PDF page, which is
  great. DO NOT CHANGE that" — the cover vertical-distribution logic (`applyCoverVerticalDistribution`)
  is considered stable/protected; extend additively, don't restructure it.
- 2026-07-06 (3 entries) — ABNT heading numbering (NBR 6024); cover city/year page-foot pinning
  (`applyCoverVerticalDistribution`, table-cell `vAlign` — the only OOXML vertical-alignment mechanism
  LibreOffice actually honors); AI-pass split-retry + escalated-retry resilience across Steps C/D/P;
  sumário rendering + real page numbers (LibreOffice render pass as the pipeline's last step); merged
  pré-textual work to `main`.
- 2026-07-02 (4 entries) — capa vertical centering (replacing a fixed-spacing hack that misplaced page
  breaks); sumário generation bugfixes (entries overflowing the page, body prose leaking into the TOC as
  a bogus heading — `demoteImplausibleHeadings`); caption formatting pass + empty-source detection;
  sumário generation built.
- 2026-06-29 — multi-line caption detection; sumário heading duplicate fix (`blockText` tab handling,
  `isBodyHeading`, Step D TOC filter, `suppressFirstHeadingPageBreak`); scroll-to-placeholder.
- 2026-06-28 — folha de rosto alignment; pré-textual section page breaks.
- 2026-06-26 (4 entries) — capa centered; caption detection tolerates blank-line gaps; pré-textual
  formatting (server-side) + slicing consistency; pré-textual element detection built (client-side).
- 2026-06-24 (2 entries) — accented title truncated on Google Docs URL upload; reasoning-effort cap on
  Step C/D (`NoObjectGeneratedError: finishReason length`).
- 2026-06-23 (2 entries) — explicit heading size/bold/caps stamped (Google Docs render fix); file
  auto-deletion cron built (`pg_cron` + `cleanupExpiredFiles.ts`).
- 2026-06-21 (10 entries) — explicit run fonts + font packaging rewrite (Google Docs font fix); Step D
  classifies the appendix; Step C URL angle-bracket/entity fix; image sizing (preserve author width,
  shrink only on overflow); missing-file recovery flow; dashboard service badges; PDF export timing;
  appendix formatted/proofread/billed correctly (only image handling skipped); appendix detection
  (any casing) + Step P reasoning cap.
- 2026-06-20 — botched-merge fix; deterministic punctuation normalization (Step Punct); interactive-input
  polish.
- 2026-06-19 (7 entries) — viewer load latency diagnosis + CDN caching fix (Supabase signed-URL region
  latency was the bottleneck, not rendering); Step C model swaps + `NoObjectGeneratedError` fix (control
  chars, wrong model); interactive input feature (batch finalize + side panel) rebuilt.
- 2026-06-16 (6 entries) — full-flow hardening + PDF export (LibreOffice headless); Step C reference
  batching fix; per-step AI models; Step P (server-side proofreading) built, replacing n8n; AI model
  update.
- 2026-06-14 (3 entries) — compact list indentation; suppress page break before first H1; deterministic
  image captions built.
- 2026-06-13 (3 entries) — preview list-numbering CSS fix; Step D list-numbering/heading-consistency
  fixes; lauda-based billing migration.
- 2026-06-09 — PageSelection reference badge + URL fetch bug fix.
- 2026-06-08 (3 entries) — codebase refactor (dead code, deps, unified status enum, code-splitting);
  Step D fix (stale `dist/` was being served); Step C built (AI reference reformatting) + prompt fix.
