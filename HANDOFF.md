# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a short dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below and in `git log`, not here.

**Last updated:** 2026-07-15

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
- **Tests:** server **406** passing (3 AI evals skipped); web **49** passing.
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer, the DOCX
  formatting pipeline Steps A/B/C/D (both AI passes: reference reformatting + headings), pré-textual
  detection + formatting + sumário generation with real page numbers, and the server-side proofreading
  pass (Step P).
- **Key features:** billing unit = lauda (~300 words); DOCX input only; full pré-textual element
  handling (capa/folha de rosto/resumo/etc detection, vertical center + city/year pinned to the page
  foot on both covers, section page breaks, 3-zone capa layout); caption detection with gap tolerance +
  embedded splitting; sumário TOC generation from detected headings with real page numbers (LibreOffice
  render pass, the pipeline's last step); appendix exclusion from billing (but included in output);
  image sizing on overflow; AI-powered heading classification + reference reformatting + grammar
  proofreading — all three AI passes with split-retry + escalated-retry resilience.

## Pipeline state (formatting)

Full breakdown: [`docs/formatting-pipeline.md`](docs/formatting-pipeline.md). Summary:

- **Step A** (deterministic styles/overrides/margins) — built, tested.
- **Step B** (deterministic references layout) — built, tested.
- **Step C** (AI reference reformatting) — built, tested, confirmed live. Behind `AI_FORMATTING_ENABLED`.
- **Step D** (AI heading reclassification) — built, tested, confirmed live.
- **Heading numbering** (ABNT NBR 6024, deterministic) — renumbers every Heading1/2/3 sequentially after Step D, before the sumário rebuild.
- **Sumário generation** (deterministic) — rebuilds the TOC from Heading1–3 after Step D; real page numbers stamped by a LibreOffice render pass as the pipeline's last step.
- **Pré-textual detection/formatting** (deterministic) — capa/folha de rosto/resumo/abstract/sumário/listas/etc. detected and excluded from billing + AI heading classification; 3-zone capa layout (institution top / content center / city-year foot); capa page number suppressed.
- **Image sizing + captions** (deterministic) — shrinks only on overflow, never enlarges; caption/source detection tolerates blank-line gaps and multi-line captions; appendix/annex images are skipped (not resized/captioned).
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
  free-models-per-day"`). Once exhausted, every AI pass (Step C/D/P) fails non-fatally until the daily
  reset — the job still finishes with deterministic formatting + placeholders, just no AI work. Add
  credits to OpenRouter (unlocks 1000/day) or wait for reset.
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

- [ ] **HIGH PRIORITY — page numbering doesn't follow ABNT NBR 14724** (2026-07-15, user-reported, not
      yet investigated or fixed). Per ABNT, every sheet from the folha de rosto onward counts toward
      the total page count, but the printed page number must stay hidden through the whole pré-textual
      region — it should only start being *displayed* on the first page of the textual part (the
      Introdução), using the correct cumulative number (not restarting at 1). Today the pipeline only
      suppresses the number on the capa's own physical first page (`suppressCoverPageNumber`,
      `preTextual.ts` — a single `<w:titlePg/>` flag). Every other pré-textual page still shows a
      number, and nothing starts the visible numbering at `bodyStart`. Needs its own section-break-based
      design (OOXML page-numbering restart at `bodyStart` + hiding the header field across the whole
      pré-textual region) — bigger than a one-line fix. See `PLAN.md` for the mirrored entry.
- [ ] **Pré-textual refinements** — the capa/folha *classification* split (vs. the now-solid formatting
      of a correctly-classified section) is still heuristic (year-line based); a field-level
      detect-and-confirm UI is the eventual fix. See `business_decisions/pretextual-elements.html`.
- [ ] **Production hosting for the PDF export.** LibreOffice is a system binary, not npm — it must
      exist wherever the server runs. **Not viable on serverless (Vercel/Lambda).** Use a Docker
      container (`apt-get install libreoffice-writer fonts-liberation`) or a Gotenberg sidecar
      (HTTP-wrapped LibreOffice — would swap `docxToPdf.ts`'s shell-out for a `GOTENBERG_URL` call).
      No host chosen yet. The export is non-fatal, so prod runs fine without it until decided.
- [ ] **Production Stripe webhook** — local dev now works via `stripe listen`, but the deployed
      environment still needs a real webhook endpoint configured in the Stripe Dashboard pointing at
      the production URL, with its own `STRIPE_WEBHOOK_SECRET`. Discussed hardening this with a
      client-side reconciliation fallback (call `stripe.paymentIntents.retrieve()` after redirect,
      idempotent on `stripe_payment_intent_id`) so trial consumption doesn't depend solely on the
      webhook landing — deliberately deferred, not yet built.
- [ ] Optional: add tests for the DOCX slicer (`docx-slice.ts`); extend test fixture with an image
      to confirm `formatCaptions` end-to-end on a real `.docx`.

---

## Session log

> Older entries are compressed to a one-line index — see `git log -p -- HANDOFF.md` for full narrative
> detail on any of them.

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
