# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a short dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below and in `git log`, not here.

**Last updated:** 2026-07-21

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
- **Build:** web production build **green**. The two unused-var errors in `ProjectDetailPage.tsx`
  (`fileName` in `PreviewError`, `pdfDownloadName`) were forgotten wiring, not dead code — both anchors
  were missing a `download` attribute their sibling "download original file" button already had. Fixed by
  wiring `download={fileName}` / `download={pdfDownloadName}` in rather than deleting the vars, which also
  fixes a small real bug (downloaded files got a random/ugly filename instead of the proper one).
- **Tests:** server **485** passing (3 AI evals skipped); web **49** passing.
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

> **MVP launch checklist (2026-07-19), triaged into what needs engineering work vs. what doesn't.**
> Goal: launch ASAP to get real-user signal on a paid product, without shipping something that breaks
> trust on the first real thesis or the first real payment. **Work the "Needs code" list top to bottom**
> — it's the priority order. Feature-level checklist lives in `PLAN.md`; this section is the
> launch-critical / cross-cutting set.

### Needs code — sorted by priority (work this list top to bottom)

1. [ ] **Handle a source document that already has its own sumário/TOC, without corrupting the file.**
       Very common in real theses (students often build their own TOC before submitting) — need to
       verify/build a reliable way to detect an existing sumário and either replace it cleanly or merge
       with it, rather than risk producing a broken or duplicated TOC. Data-integrity risk, not just a
       quality one — worth resolving before broad real-user testing, not after.
2. [ ] **PDF export / LibreOffice has no production home.** Not just the "download PDF" button — the
       sumário's real page numbers AND the ABNT header page-number start are both resolved by a LibreOffice
       render pass (`paginateSumario.ts`). No LibreOffice in prod means every document ships with blank
       page numbers, not just a missing PDF — affects 100% of documents, not a subset. LibreOffice is a
       system binary, not viable on serverless (Vercel/Lambda). **May need ZERO code**: installing the
       binary in a Docker deploy image (`apt-get install libreoffice-writer fonts-liberation`) means
       `docxToPdf.ts` just works as-is. Only becomes a real code task if a Gotenberg sidecar is chosen
       instead (would swap the shell-out for a `GOTENBERG_URL` call). No host/approach chosen yet.
3. [ ] **Processing queue — survive a server restart, and stagger jobs to save infra cost.** Today
       `processFormatting` is fire-and-forget in-process; if the server process dies or restarts mid-job,
       that job just vanishes — no retry, no status update, and (once paid) a customer who's paid with no
       output and no explanation. Need a real queue (durable — Postgres table + polling worker, or a
       proper queue service) so an in-flight job resumes from where it left off after a restart, AND so
       jobs can be processed one/few-at-a-time instead of all firing concurrently (reduces peak memory/CPU,
       relevant for a budget host). Ties into the existing `processing_attempts` retry-cron machinery but
       is a broader rework — that cron only catches rate-limited jobs today, not "the process died."
4. [ ] **Accessibility pass.** Only 5 of 23 page/component `.tsx` files have any `aria-label`/`role`
       attribute at all. shadcn/ui's Radix primitives give some baseline (focus trapping, keyboard nav on
       dialogs), but the custom flow (file upload, page-selection grid, checkout form) likely has real
       gaps — unlabeled icon-only buttons, missing focus states, no screen-reader text on status badges.
       A manual pass with a screen reader through signup → upload → checkout → dashboard would catch the
       worst of it. Broader/fuzzier scope than a single bug fix (an audit + many small fixes), so ranked
       below the correctness/reliability items above.
5. [ ] **Ficha catalográfica gets centered/distributed like the folha de rosto (known bug, reported
       2026-07-17).** It has no pré-textual kind, so it's absorbed into the `folhaDeRosto` section and
       gets `COVER_STYLE` centering + full-page vertical distribution it shouldn't. Full diagnosis in
       `PLAN.md` (Backend / AI Pipeline). Narrow scope (only docs with this specific pré-textual element)
       and currently **blocked — still waiting on a real `.docx` from the user to anchor the fix.**
6. [ ] **Table formatting isn't ABNT-compliant yet** — label above ("Tabela N — …"), source below
       ("Fonte: …"), open horizontal borders (no vertical rules), centered placement. Scope depends on how
       common complex tables are in real target-user theses (unconfirmed); worth a quick look before
       deciding if it blocks broader launch.

### No code needed — config / dashboard / billing actions (do whenever, not code work)

- [ ] **Production Stripe webhook.** Local dev works via `stripe listen`; the deployed env needs a real
      webhook endpoint in the Stripe Dashboard with its own `STRIPE_WEBHOOK_SECRET`. Order recording AND
      trial consumption both depend on it. Consider the client-side reconciliation fallback (post-redirect
      `stripe.paymentIntents.retrieve()`, idempotent on `stripe_payment_intent_id`) so it's not the sole
      path — discussed, deferred, not built (that fallback WOULD be code, if pursued).
- [ ] **Move off the OpenRouter free tier before real usage.** 50 requests/day account-wide caps you at
      ~2-3 docs/day total (a full thesis is 30-40+ AI calls) — this alone blocks testing with more than a
      couple of real users. Rate-limit handling degrades gracefully (see 2026-07-17 session log) but paid
      credits (1000/day) are needed for any real volume. Pure billing action, add credits on OpenRouter.
- [ ] **Confirm the Supabase Storage `projects` bucket has a file-size limit configured.** Upload goes
      client-side straight to Storage (no server-side multer/size check found) — an oversized `.docx`
      could hang LibreOffice conversion or spike memory. Set the cap in the Supabase dashboard.

### Real-world testing / verification (minimal-to-no code)

- [ ] **Validate pricing with a real, complete test document before setting the per-lauda price.** Need
      one full document (~40 pages) exercising every pipeline path: tables, images (some with
      captions/sources present, some deliberately missing to exercise the `needs_input` flow), an
      appendix, and all pré-textual elements (capa, folha de rosto, ficha catalográfica, resumo/abstract,
      sumário, listas). Process it under the real paid flow to learn actual AI cost + time per lauda —
      the current R$1/page (formatting) / R$2/page (proofreading) pricing hasn't been validated against a
      real document. Foundational: can't honestly test a *paid* MVP without knowing the price is right.
      The validation itself isn't code; only a trivial constant update in `pricing.ts` follows from it.
- [ ] **Comprehensive free-trial security test.** Verify the trial can't be abused: multi-page selection
      can't get the free discount, a second trial can't be triggered after the first is consumed, and
      manipulating client-side `isFree`/`isTrial` flags has no effect (should already be re-verified
      server-side in `checkout.ts` — confirm by hand). Only becomes a code task if the test finds a gap.

### Explicitly post-MVP — not required for this launch

- [ ] **Guideline isolation — make sure every formatting pass is scoped to ABNT and none of it leaks
      into APA/MLA/Chicago.** Launching Brazil-first/ABNT-only, so this doesn't block launch functionally.
      Important architecture hygiene before actually adding a second guideline later; do it in a separate
      branch, ONLY if it doesn't cost quality or the launch timeline — revisit after the above items ship.

### Trust & recourse (business, not just code)

- [ ] **Operator alerting / error monitoring** (e.g. Sentry). Today a degraded doc only `console.error`s.
      For a low-volume MVP a human backstop — get pinged when a job fails/requeues/degrades — is worth a
      lot while real-doc bugs are still being found.
- [ ] **Refund/redo path.** Students pay for an unseen result on their most important document, and there's
      no mechanism to flag a bad output and get it corrected. Essential for trust given the stakes; consider
      a satisfaction guarantee and/or preview-before-pay.
- [ ] **Email from a verified domain.** Still `onboarding@resend.dev` — reads as untrustworthy for a paid
      service. Verify the domain in Resend and swap the `from` address.
- [ ] **Audit the pipeline for missing ABNT elements.** Confirmed handled: headings, references,
      captions/images, pré-textuais, pagination, long quotations (citação longa > 3 linhas, `longQuotes.ts`).
      NOT confirmed and common in theses: footnotes. Worth a deliberate audit before claiming "near perfect."
- [ ] **Pré-textual classification is still heuristic** (year-line based capa/folha split); a field-level
      detect-and-confirm UI is the eventual fix. See `business_decisions/pretextual-elements.html`.

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

### 2026-07-21 — Output-validation backstop, API rate limiting, embedded long-quote splitting

Worked the top of the "Needs code" list for the items that didn't need user input (the rest — LibreOffice
hosting, the processing queue, ficha catalográfica, table formatting — genuinely need a decision or a real
`.docx` first, so left as-is).

**Output-validation backstop** (`validateOutput.ts`, new): runs just before `complete` is stamped (right
after `paginateSumario`, formatting-only, `pending.length === 0`). Checks: `document.xml` is well-formed
(hand-rolled tag-balance + stray-`&` scanner — no full XML parser dependency existed in this codebase, and
none was worth adding for this), no leftover red caption/source placeholder survived past the
`needs_input` gate, sumário entry count matches the body's Heading1–3 count (reuses `buildSumario`'s own
`headingLevel`, now exported, so the two counts are always comparing like with like), references located
when `references_pages` was flagged, and the ABNT header `pgNumType` start isn't still the `"1"`
placeholder when there's front matter. Any issue throws, which routes through the *existing*
rate-limit-era catch-all in `processFormatting` (revert to `pending`, logged as FAILED) — deliberately no
new project status or DB/frontend changes; reuses the same "genuinely broken job sits until
`processing_attempts` caps it" contract rate-limited jobs already have. 16 new tests.

**Rate limiting**: added `express-rate-limit` (zero new transitive deps, confirmed via `npm audit` that no
new vulnerabilities came in) — `processingLimiter` (20/15min) on `/api/processing/start`, `checkoutLimiter`
(30/15min) on `/api/checkout/create-payment-intent` and `/complete-free-order`. `req.ip` is left on the
un-proxied default (no `trust proxy` set) since no deploy host is chosen yet (item #2 below) — whoever
picks one must set `trust proxy` to match its topology or the limit degrades to one shared budget behind
an unconfigured reverse proxy.

**Embedded long-quotation splitting** closes the `formatLongQuotes` gap: a quotation with real lead-in
prose before it (and optionally more prose after) now gets split into up to three paragraphs — lead-in /
LongQuote-styled quote (marks stripped) / trailing — instead of being left inline. Reuses `runs.ts`'s
paragraph parser (newly exported: `parseParagraph`, `Item`) for the run-level split so bold/italic spans
survive; bails (leaves the paragraph untouched) on any shape it can't safely splice (hyperlinks, fields,
footnotes, tabs, drawings), same conservative contract as the rest of the pipeline. Gate is on the quoted
SPAN's length (≥280 chars), not the whole paragraph's — a long paragraph wrapped around a short quote
correctly stays inline. 6 new tests.

Server suite 485 passing (was 463), `tsc --noEmit` clean. `PLAN.md`/`HANDOFF.md`'s "Needs code" list
trimmed to the 6 remaining items.

**Follow-up, same day — client-side laudas mis-detection on a document with its own sumário/TOC** (user
report, anchored on a real Google Docs upload the user shared). Reported symptom: an existing summary's own
entries showing up as billable laudas on the page-selection screen. Root-caused with the real file (rendered
through the actual `docx-preview` pipeline via a temporary debug route, not guessed): the summary ITEMS were
never the problem — `docx-preview` already renders each TOC line as its own correctly-spaced block
(`"SUMÁRIO 1"`, `"Os personagens Principais 1"`, …). The real cause is `web/src/lib/pretextual.ts`'s
`isBodyHeading`, which only recognizes a real chapter start via a **leading number** — this document's
chapters aren't numbered yet (numbering is itself something the paid pipeline adds, so a fresh upload
commonly arrives without it), so the search for `bodyStart` never matches anything and fell back to
"immediately after the SUMÁRIO label" — meaning the TOC's own entries AND the entire real body all counted
as laudas. Fix: skip a leading run of blank lines and TOC-entry-shaped lines (`isTocEntry` — dot leaders or
a trailing page number) right after the last pré-textual signal before searching for a heading; this is a
no-op for other labeled sections (resumo/abstract/…, guarded by a new test) but gives a correct fallback —
"right after the summary's own paginated entry list" — instead of "right after the label" when nothing in
the body is numbered. Verified on the real file both via unit tests (3 new, `pretextual.test.ts`) and by
re-running the actual render pipeline against it: `bodyStart` now correctly lands on the first real chapter
(index 6), sumário section correctly spans the label + all 3 entries + trailing blanks. Web suite 52
passing (was 49), `tsc -b` clean. Two related findings, deliberately NOT fixed in this pass: (1) the
*server-side* half of "handle an existing sumário" — replacing it during `buildSumario` without corrupting
the file; (2) a latent regex bug in the server's `blockText()` (`blocks.ts`) where `<w:t[^>]*>` also matches
`<w:tabs>`/`<w:tab …/>` and swallows content up to the next real `</w:t>` — doesn't affect this screen
(which renders via real DOM, not that regex), tracked separately in `PLAN.md`.

**Immediate follow-up, same day — server-side duplicate sumário bug, fixed.** User then actually processed
a document with its own sumário through the full pipeline: the final file had TWO summary sections. Desired
policy confirmed with the user: if the original has a summary, replace it with the generated one; if not,
keep current behavior (`buildSumario` already no-ops when none is detected — untouched). Root-caused against
the real file (compiled the relevant server modules standalone and ran them against the actual
`document.xml`, not guessed): `classifyPretextual` (server) is a straight port of the client detector and
had the *exact* same unnumbered-heading gap fixed above — `bodyStart` fell back to right after the label, so
the detected `sumario` section spanned only the label itself. `buildSumario`'s replacement logic was already
correct — it just trusted that (too-short) section extent, so it glued the freshly-built entries onto the
label's own block while the original TOC (a `<w:sdt>`-wrapped Word/Google-Docs auto-TOC field) survived
completely untouched immediately after: two sumário-looking listings back to back. Fix: applied the same
`isTocEntry`-skip to `classifyPretextual` (`server/src/lib/formatting/preTextual.ts`) — an `<w:sdt>` block
reads as blank here (`detectPretextual` only computes `blockText` for real `<w:p>` blocks), so it gets
skipped the same way blank lines do, needing no separate handling. Verified against the real file (same
standalone-compile approach): `bodyStart` now correctly lands past the whole original TOC, and
`buildSumario`'s output is clean — new entries immediately followed by the real body, zero leftover
`<w:sdt>`/field-code content. 3 new tests (`preTextual.test.ts`, including an XML-level
`detectPretextual`+`buildSumario` integration test built from the real bug's shape). Server suite 488
passing (was 485), `tsc --noEmit` clean.

**Third follow-up, same day — placeholder detection silently not firing, fixed.** User: processed a file
selecting both formatting and proofreading and it never asked for missing caption/source input, though the
doc has an uncaptioned image. User's own hypothesis ("could the appendix label in the summary be
interfering with images?") was directionally right, one layer removed — traced end-to-end by running the
real deterministic pipeline (Steps A/B, pré-textual, heading numbering, `buildSumario`, image/caption
passes — AI steps skipped, they don't touch this path) against the actual file via a throwaway vitest test.
Root cause: this document's real appendix heading is literally "Apêndices" — same as this thesis's
appendix — and `buildSumario` rebuilds a TOC entry for every real heading, so the sumário gets its own
"Apêndices" entry, with NO page number yet (filled in much later by `paginateSumario`). `processFormatting`
re-runs `locateAppendixStart` right after `buildSumario` (block count changed), and a bare, un-paginated
"Apêndices" entry satisfies `looksLikeAppendixHeading` exactly as well as the real heading — so it locked
onto the sumário's own echo (block 2) instead of the real appendix (block 29), freezing image/caption/
placeholder detection for nearly the entire document. **Fires on any document with both a sumário and an
appendix — standard ABNT shape, not an edge case** — almost certainly why this was never caught before now.
First attempt (excluding blocks inside `detectPretextual`'s own sumário section) wasn't sufficient on its
own — that section's own boundary has the identical blind spot (its `isTocEntry` check needs a page number
the fresh entry doesn't have yet). Fixed by reusing `sumarioPagination.ts`'s `findSumarioEntries` instead —
it recognizes `buildTocEntry`'s structural signature (right-tab + suppressAutoHyphens) independent of
whether a page number is present, so it correctly covers every rebuilt entry. Verified against the real
file: `appendixStart` now correctly lands at 28 (was wrongly 2), and placeholder detection correctly flags
the body image's missing caption/source while still excluding the real appendix's own image. 1 new test
(`postTextual.test.ts`, built via the real `buildSumario` output, not a hand-written fixture). Server suite
489 passing (was 488), `tsc --noEmit` clean.

**Fourth follow-up, same day — sumário lines wrap in the `needs_input` preview, fixed.** User: when a doc
needs input, the sumário renders broken (lines wrapping) in the preview; after the user fills the inputs
and the doc reprocesses to final, it renders correctly. Same root cause as the 2026-07-17 "sumário entries
wrapping" bug, just a different trigger: `buildSumario`'s freshly-built entries leave the page-number column
completely blank — a bare `<w:r><w:tab/></w:r>` — because real numbers are only stamped by `paginateSumario`,
the pipeline's last step, which `needs_input` docs never reach (deliberately, to avoid baking
placeholder-shifted numbers). docx-preview's right-tab-stop word-spacing calibration blows up specifically
when NOTHING follows the tab, wrapping the entry onto extra lines. Confirmed empirically end-to-end against
the real file: reproduced the exact `needs_input` document via the real deterministic pipeline (a throwaway
vitest test, AI steps skipped), rendered it through the *actual* `DocxViewer` sequence (`TAB_STOP_SETTLE_MS`
zoom-hold, `DOCX_PAGE_STYLES`, the same 600ms settle) in the browser pane — entries measured 65px/43px tall
(wrapped) vs. a correct 22px. Tested the fix hypothesis the same way before touching source: patching in
ANY character after the tab (not necessarily a real number) fixed it immediately (22px, single line) — so
this is a genuine fix, not a workaround. Implemented: `buildTocEntry` now stamps a placeholder
(`SUMARIO_PAGE_PLACEHOLDER = '—'`, exported from `sumario.ts`) after the tab instead of leaving it bare;
`setEntryPageNumber` (`sumarioPagination.ts`) now recognizes and overwrites that placeholder (previously its
regex only matched an existing *digit* run) once the real page number is known, same as it already did for
a re-run. Never reaches a final PDF (LibreOffice/`paginateSumario` always resolves it before any PDF export)
— the only place it's ever visible is the preview, and only before pagination has run. Re-verified against
the real file with the actual (fixed) production code end-to-end: all entries render single-line. 3 existing
tests updated for the new entry shape (they now include the placeholder), 1 new test locking in the
placeholder itself. Server suite 490 passing (was 489), `tsc --noEmit` clean.

### 2026-07-19 — MVP launch checklist + web production build fix

Reworked `HANDOFF.md`'s "Open work" section into a single priority-sorted MVP launch checklist per the
user's request (17 items — RLS check first, then pricing validation, infra, correctness, security
hardening, accessibility, then the narrower known bugs, guideline isolation last as explicitly post-MVP).
Added 4 new items the user flagged: a durable processing queue (survive a server restart + stagger jobs
for infra cost), handling a source doc that already has its own sumário without corrupting it, pricing
validation against a real ~40-page test document, and guideline isolation (ABNT-only scoping audit before
adding other guidelines) — the three engineering-shaped ones also got entries in `PLAN.md`.

Fixed item 4 (web production build broken): the two `tsc -b` unused-var errors in `ProjectDetailPage.tsx`
were forgotten wiring, not dead code — `PreviewError`'s download link and the "Baixar PDF" button were
both missing the `download` attribute their sibling "download original file" button already had (which
uses `download={project.original_file_name}`). Wired `download={fileName}` / `download={pdfDownloadName}`
into both anchors instead of deleting the vars — fixes the build AND a small real bug (those two downloads
previously got a random/ugly filename instead of the proper one). `npm run build` green, lint errors
13→11 (remaining 11 are pre-existing `react-hooks/set-state-in-effect`, unrelated), web suite 49/49.

**RLS verified secure — item 1 done, no code changes needed.** User ran
`select tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public'`
and shared the output. `orders`: `SELECT` only (`auth.uid() = user_id`), no `INSERT`/`UPDATE`/`DELETE` —
correct, since orders are only ever written server-side with the service-role key (bypasses RLS).
`user_profiles`: `SELECT` only (`auth.uid() = id`), no `UPDATE` — correct and important, since that's what
stops a user resetting their own `trial_used_at` to reclaim the free trial; a future editable-profile
feature will need a narrowly-scoped `UPDATE` policy that excludes `trial_used_at`. `projects`:
`INSERT`/`SELECT`/`UPDATE` all correctly scoped to `auth.uid() = user_id`, no `DELETE` (matches — no
delete-project UI). Some policies use the `public` role instead of `authenticated`, which looked
suspicious at first glance, but is harmless: the qual still requires `auth.uid() = user_id`, and
`auth.uid()` is `NULL` for anon requests, so `NULL = user_id` never evaluates to true — anon access stays
blocked either way. Only real finding: `projects` has two identical-in-effect `SELECT` policies (one
`public`-scoped, one `authenticated`-scoped) — pure redundancy, no security impact, optional cleanup.

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
clean. Embedded mid-paragraph quotations (lead-in prose before the quote) were out of scope at the time —
closed in the 2026-07-21 entry above.

### Earlier sessions (index only — see `git log -p -- HANDOFF.md`)

- 2026-07-17 (2 entries) — sumário entries wrapping in docx-preview: two separate bugs, both fixed —
  `setEntryPageNumber`'s regex didn't account for the explicit-font pass stamping `<w:rPr>` onto the tab
  run (0/N page numbers stamped), and separately the viewer's `display:none` load-hiding zeroed the
  paragraph rects docx-preview's tab-stop pass measures (fixed by never hiding via `display`/`visibility`,
  letting the opaque spinner do the hiding instead). AI silent-degrade fix: a rate-limited AI pass
  (OpenRouter free-tier) used to be swallowed and still stamp `complete` — now `isRateLimitError` fails
  fast and aborts the whole job to `pending` instead, plus a daily `retry-pending` cron.
- 2026-07-16 (2 entries) — ABNT header page numbering (NBR 14724) built: real OOXML section split at
  `bodyStart` (pré-textual region gets an empty header/footer, textual part gets a clean number-only
  header), the correct `pgNumType` start resolved by the LibreOffice render pass. Three real bugs found
  only by rendering through actual LibreOffice (non-greedy sectPr regex, missing `xmlns:r`, an idempotency
  guard that short-circuited on a real doc's inherited header). Real-doc follow-up: SUMÁRIO title splitting
  from its own entries, fixed by anchoring `bodyStart` past the sumário's structurally-identified entry run.
- 2026-07-15 (2 entries) — trial-discount webhook fix (missing `STRIPE_WEBHOOK_SECRET` in local dev, fixed
  via `stripe listen`; still needs its own prod secret); unnumbered "Introdução" heading silently deleted
  by the sumário rebuild (`isBodyHeading` only recognized a literal leading digit) — fixed with
  context-aware detection (`isIntroducaoWord` + `looksLikeBodyProse`, distinguishes a real heading from a
  same-text TOC entry by whether real prose follows it).

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
