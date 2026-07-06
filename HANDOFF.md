# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below, not here.

**Last updated:** 2026-07-06

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

- **Branch:** `main` — all pré-textual work (detection, formatting, refinements) merged and shipped.
- **Build:** web production build **verified green (2026-06-17)** (`npm run build` in `web/`).
- **Tests:** server **359** passing (3 AI evals skipped); web **38** passing.
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer,
  the DOCX formatting pipeline Steps A/B/C/D (both AI passes: reference reformatting + headings),
  pré-textual detection + formatting + sumário generation, and the server-side proofreading pass (Step P).
- **Key features:** billing unit = lauda (~300 words); DOCX input only; full pré-textual element handling (capa/folha de rosto/resumo/etc detection, vertical centering, section page breaks); caption detection with gap tolerance + embedded splitting; sumário TOC generation from detected headings (page numbers pending); appendix exclusion from billing (but included in output); image sizing on overflow; AI-powered heading classification + reference reformatting + grammar proofreading.

## Pipeline state (formatting)

- **Step A** (deterministic styles/overrides/margins) — built, tested.
- **Step B** (deterministic references layout) — built, tested.
- **Step C** (AI reference reformatting) — **built, unit-tested, and confirmed live (2026-06-17)**. Returns `[{ i, segments }]`; deterministic code renders runs and splices over each entry, keeping Step B's `<w:pPr>`. Behind `AI_FORMATTING_ENABLED`. Bold renders correctly in the output `.docx` on a real upload.
- **Step D** (AI heading reclassification) — built, tested, and confirmed working live.
- **Step E** (re-zip / upload / stamp / email) — built.
- **Image sizing** (deterministic) — built, unit-tested. `imageLayout.ts` `formatImages`
  **preserves each `<wp:inline>` image's author-chosen width** (guidelines specify no image size; authors
  size figures on purpose) and only **shrinks an image that overflows the page content width** — it never
  enlarges. Centers the image paragraph; floating `<wp:anchor>` images are skipped. Runs over the WHOLE
  document, including the appendix/annex (an oversized image leaks the page there too — the cap is the
  only thing that prevents it; confirmed live 2026-06-21). Caption/source insertion still skips the
  appendix. (Earlier "force 70%" behaviour and "skip appendix resize" were both replaced by this.)
- **Image captions** (deterministic) — built, tested, and **verified on a real document**.
  `formatCaptions` in `captions.ts` runs around each image (`<w:drawing>`/`<w:pict>`/`<w:object>`):
  - Styles the paragraph **before** as `Caption` when it opens with a figure label
    (`Figura 1 —`, `Imagem 2 -`, `Gráfico 3:`, including period separator `Figura 1.`).
  - Styles the paragraph **after** as `Caption` when it opens with a source label (`Fonte:`, `Fonte.`).
  - **Dot → colon normalization:** rewrites `Figura N.` → `Figura N:` and `Fonte.` → `Fonte:` in
    the first text run, preserving sub-numbers (`12.1.` is left alone).
  - **Embedded caption/source splitting:** when a Google-Docs-exported image paragraph carries its
    caption/source as an extra `<w:r>` run inside the same `<w:p>` as the `<w:drawing>`, the run
    is split into its own Caption-styled paragraph (3 paragraphs: label + image + source), normalized.
  - **Table captions/sources** get the same styling pass: `Table N.` → `Table N:` + Caption style
    on the paragraph above a `<w:tbl>`, source line below.
  - **`keepWithNext`** on label/blank lines so captions never split from the image across pages.
  - `detectAndInsertPlaceholders` (in `missingInputs.ts`) runs **after** `formatCaptions` and inserts
    red placeholder paragraphs for genuinely missing captions/sources. Guards include: period-separator
    recognition, stacked-image suppression (`nextBlockStartsAnotherLabel`), same-paragraph embedded text
    (`ownText` guard), and — new — **empty source detection**: a `Fonte:` or `Fonte. ` line with no
    content after the separator is **replaced in-place** with a placeholder (block count unchanged)
    rather than being treated as a valid source.
  - `TABLE_LABEL_RE` and `isTableBlock` are exported from `captions.ts`; `missingInputs.ts` imports them.
  - Appendix/annex image passes frozen at `captionFreezeAt` (no captions for reproduced third-party docs).
- **List indentation** (deterministic) — `normalizeNumberingXml` rewrites every `<w:lvl>` in
  `word/numbering.xml` before any other pass runs. Per-level step is 480 twips (≈ 0.85 cm),
  down from Word's default 720 twips/level; hanging = 240 for all levels. Applied in
  `processFormatting` right after `unzipDocx`. 5 unit tests in `normalizeNumbering.test.ts`.
  Adjust the `STEP` constant in `normalizeNumbering.ts` to tune.
- **First-H1 page break** (deterministic) — `Heading1`'s style carries `<w:pageBreakBefore/>`
  (every H1 starts a new page), but `suppressFirstHeadingPageBreak` cancels it on the **first**
  H1 via an inline `<w:pageBreakBefore w:val="false"/>` override. Runs after the AI heading pass
  (the first H1 may be one Step D promoted). Avoids a lone-title page / blank page after a cover.
- **Step Punct** (deterministic punctuation normalisation) — `applyPunctNorm`. Runs as the **first
  stage of the proofreading service**, before the AI pass, so the model sees clean text and only does
  grammar. Belongs to proofreading, not formatting (a format-only doc keeps the author's punctuation).
  Rules: collapse double spaces, remove space-before-punctuation, **add missing space-after-punctuation**
  (period only before an uppercase letter, to spare URLs/numbers; comma/semicolon/colon before any
  letter), **smart/curly quotes**, ellipsis → `…`, **spaced em dash** (skips numeric ranges), and a
  **non-breaking space between a number and its unit** (`10 km`). `applyPunctNormWithStats` returns
  per-rule counts; `processFormatting` logs them (`Step Punct: … space-after-punct, … smart-quote, …`).
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
  (Step D), `AI_REFERENCES_MODEL=nvidia/nemotron-3-super-120b-a12b:free` (Step C),
  `AI_PROOFREAD_MODEL=nemotron-3-nano-30b-a3b:free` (Step P)** — ultra for headings, super for
  references, nano for proofreading. **Only Step D (heading classification) actually needs ultra;
  super is enough for Step C references.** `AI_MAX_TOKENS=8192` and `AI_MAX_CHARS_PER_CHUNK=3000` —
  reasoning models need the larger token budget or JSON truncates mid-response. **Step P has its
  own token budget** `AI_PROOFREAD_MAX_TOKENS` (default 4096) so proofreading generations are
  shorter (faster, fewer mid-stream resets) without starving Step C/D.
  **Never use nano for Step C:** it over-reasons (7k+ reasoning tokens on a single reference entry)
  and corrupts the JSON → `NoObjectGeneratedError` (incidents 2026-06-19/06-20). **Step P is also
  structured JSON** (`{i,text}` via `generateObject`), so nano over-reasoned it too and hit
  `finishReason: length` (3.7k reasoning tokens, never emitted the JSON; incident 2026-06-21). Capping the
  effort (`AI_PROOFREAD_REASONING_EFFORT`, OpenRouter `reasoning.effort`, default **low**, passed in
  `proofreadDecider`) did **not** tame nano, so **Step P now runs on `nemotron-3-super-120b-a12b:free`** in
  `.env` — the same model that emits clean JSON on Step C. **Lesson: every structured-JSON pass (C/D/P) needs
  super/ultra; nano is unsafe for all of them.** The reasoning knob stays (it trims super's token use too).
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
  output) is also fixed: `AI_REFERENCES_MODEL` is set to **super** in `.env` (super handles Step C;
  ultra is reserved for Step D headings).
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
- [x] ~~**Merge `feature/docx-page-detection`** into main~~ — **merged 2026-07-06**.
- [ ] **Pré-textual refinements** — full vertical distribution (3-zone layout: institution top / title
      middle / city+year bottom; requires field-level detect-and-confirm UI); fix capa↔folha split for
      single-year-line documents (split by page boundaries, not year-line count).
      See `business_decisions/pretextual-elements.html`.
- [x] ~~**Sumário regeneration**~~ — **Built (2026-07-02), bug-fixed same day.** `buildSumario` in
      `sumario.ts` scans Heading1–3 styled paragraphs in the body after Step D and rebuilds the sumário
      section content. The "SUMÁRIO" label is preserved; existing content blocks are replaced; extra
      blocks are deleted or content is appended if the section was label-only. Page numbers left blank
      (dot-leader tab stop, empty number). `appendixStart` recomputed after the sumário rebuild so the
      caption freeze index stays correct.
      **Bugs found via a real upload screenshot, fixed same day:** (1) entries had no `w:pStyle`, so they
      inherited the ABNT body style (justified, 1.25cm first-line indent) — a short title stretched across
      the full width and wrapped, pushing the dot-leader tab off the page. `buildTocEntry` now stamps
      `w:jc="left"` + `w:firstLine="0"` explicitly. (2) A body paragraph the author left in a Heading style
      (forgot to switch back to Normal after a subheading — real case: a whole artist biography paragraph
      styled `Heading3`) was swept whole into the sumário as a giant "entry". Fixed at the source with a new
      deterministic pass, `demoteImplausibleHeadings` (`headingSanity.ts`), run right after Step B/before
      Step D: clears the Title/Heading style off any paragraph over `MAX_HEADING_CHARS` (200, now shared
      from `blocks.ts`) — Step D itself only ever *promotes* headings by design, never demotes, so nothing
      else could have corrected this. `buildSumario` keeps the same length guard as a second line of
      defense. 18 unit tests across `sumario.test.ts` + new `headingSanity.test.ts`. **Still open:** real
      page numbers (needs a TOC field / pagination render pass); REFERÊNCIAS and other
      `ReferencesHeading`-styled sections aren't scanned into the sumário (only Heading1-3 are). No
      browser-verified end-to-end yet (backend-only XML logic, not exercised by the Vite preview).
- [x] ~~Migrate proofreading off n8n into the server~~ — done (Step P). Live-confirm on a real
      multi-page `.docx` upload (the inline eval fixture passed; one real end-to-end run pending).
- [x] ~~Bug — references-formatting option shown without the formatting service.~~ **Fixed
      (2026-06-16).** `PageSelectionPage.tsx` now derives `showReferences = activeServices.has('formatting')`;
      the references card is hidden for proofreading-only orders, no longer gates Continue
      (`referencesValid = !showReferences || …`), and `formatReferences` is sent as `undefined` unless
      formatting is selected. Step P still auto-detects + skips references server-side regardless.
      tsc clean; not browser-verified (will be covered by the next full-flow run).
- [x] ~~**PDF export — full flow live-check.**~~ **Confirmed live, working very well.**
      DOCX→PDF export (`server/src/lib/docxToPdf.ts`, `processFormatting` step 6b, "Baixar PDF Final"
      button in `ProjectDetailPage`) verified end to end: LibreOffice installed
      (`SOFFICE_PATH=/Applications/LibreOffice.app/Contents/MacOS/soffice` in `server/.env`), real doc
      reprocessed, button appears, ABNT margins/pagination/fonts survive. (Prod hosting still open below.)
- [ ] **Production hosting for the PDF export.** LibreOffice is a system binary, not npm — it must
      exist wherever the server runs. **Not viable on serverless (Vercel/Lambda).** Use a Docker
      container (`apt-get install libreoffice-writer fonts-liberation`) or a Gotenberg sidecar
      (HTTP-wrapped LibreOffice — would swap `docxToPdf.ts`'s shell-out for a `GOTENBERG_URL` call).
      No host chosen yet. The export is non-fatal, so prod runs fine without it until decided.
- [x] ~~**Missing-file recovery flow**~~ **Built (2026-06-21 later 5).** The pipeline's null-path
      guard now stamps `status: 'missing_file'` + emails the user to re-upload (no re-charge);
      `ProjectDetailPage` shows a re-upload panel → `POST /api/processing/recover-file` stamps the path,
      sets `pending`, and re-triggers. See session log. **Live-verified end to end on a real flow
      (2026-06-21).** Root-cause fix (upload before payment + persist the path string in
      `sessionStorage`) still deferred.
- [x] ~~**Bug — dashboard shows only one service badge for format+proofread projects.**~~ **Fixed
      (2026-06-21 later 3).** `mapDbProject` (`DashboardPage.tsx`) kept only `row.services[0]`; now it
      carries the full `services[]` array and the row renders one `ServiceBadge` per service in a
      canonical order (formatting → proofreading), with the guideline shown only on the formatting
      badge. Badge group is `shrink-0 flex-wrap justify-end` so both stay visible at every width.
      Build + 35 web tests green; **not browser-verified** — needs an authed user with a both-services
      project (can't seed without the full checkout flow).
- [x] ~~File auto-deletion cron~~ **Built (2026-06-23).** `cleanupExpiredFiles.ts` +
      `POST /api/maintenance/cleanup-expired`, scheduled by Supabase pg_cron (`server/sql/cleanup_cron.sql`).
      See session log. **Deploy:** run the SQL once + set the two Vault secrets. **Endpoint
      live-verified 2026-06-23** (isolated fixture: 3 objects deleted, row stamped, idempotent, 401 on
      bad secret). pg_cron trigger itself unverified until a server URL exists.
- [ ] Optional: add tests for the DOCX slicer (`docx-slice.ts`); extend test fixture with an image
      to confirm `formatCaptions` end-to-end on a real `.docx`.

---

## Session log

### 2026-07-06 — Merge pré-textual work to main

Pré-textual detection, formatting, and refinements complete and merged. Branch `pretextual-detection`
contained all work from 2026-06-26 onward: client-side and server-side pré-textual detection + formatting,
sumário generation with bug fixes, caption improvements (multi-line, gap tolerance, embedded splitting),
and vertical centering of the capa section. Server suite **359 passing** (3 AI evals skipped), web suite
**38 passing**. All changes committed to main; branch ready for deletion.

**Still open (future work):** full ABNT 3-zone capa layout (institution top / title middle / city+year bottom)
needs field-level classification and a detect-and-confirm UI step; capa↔folha split heuristic breaks on
single-year-line documents (needs split-by-page-boundary logic); real page numbers in sumário (TOC field
or pagination render pass); REFERÊNCIAS section inclusion in sumário TOC.

### 2026-07-02 (later 3) — Real-document test of the capa centering fix surfaces 3 bugs

User tested the capa-centering change (previous entry) on a real thesis export
(`Copia_de_00_TCC_VivianDominot`, 65 pages) and reported: (1) the exported PDF's cover has no
city/date, (2) the DOCX preview's sumário looks "very strange" (artist names as TOC entries,
one showing literal `&amp;`), (3) some images are separated from their caption line above.
Diagnosed all three against the real PDF (`pdftotext -layout` + page renders via `poppler`,
installed this session — `brew install poppler`, no `pdftoppm` was available before).

**Bug 1 — cover "missing" city/date: a real classifier gap, not a regression.** `pdftotext`
confirmed the document's entire front matter (capa text, a stray personal to-do-list page the
author forgot to delete, and the folha de rosto) has only **one** standalone year-line
("2026"), not two. `classifyPretextual`'s capa↔folha split requires `yearLines.length >= 2` to
treat the region as two separate cover pages — with only one, the whole thing collapses into a
single `folhaDeRosto` section, so `applyCoverVerticalDistribution` (which only targets a
`capa`-kind section) correctly never fires, and the city/year line simply sits wherever the
author's own pre-existing page breaks put it (in this doc, alone on its own page). **Not fixed
this session** — logged as an open item (see PLAN.md pré-textual bullet); a real fix needs to
split the merged region by actual page boundaries, not year-line counting, and decide what to
do with non-cover content caught inside it (the stray notes page).

**Bug 2 — ampersand double-escaping in the sumário.** "CESAR & LOIS" rendered as the literal
text "CESAR &amp; LOIS". `blockText` (`blocks.ts`) extracted `<w:t>` inner content without
decoding XML entities — a literal `&` is always stored as `&amp;` in valid XML, so `blockText`
returned the raw string `&amp;`, and `buildTocEntry`'s `escapeXml()` re-escaped it into
`&amp;amp;`. Fixed at the source: new `decodeXmlEntities` (`xmlText.ts`) — `blockText` now
decodes before returning (a general correctness fix, not sumário-specific). +5 tests.

**Bug 3 — a caption lead-in sentence swept into the sumário AND stranded across a page break.**
The document has a short (155-char, under `MAX_HEADING_CHARS`) descriptive sentence — "Com 800
metros quadrados, este painel é o maior da série…" — styled `Heading3`, sitting directly before
an image's "Figura N:" label. It leaked into the sumário as a bogus TOC entry, and — because it
carries the Heading style's own layout rules — ended up alone at the bottom of one page while
the actual figure/label/image/source group moved to the next page (this is what the user saw as
"images separated from their caption"; the caption LABEL itself was correctly bound to its
image — it was this preceding lead-in sentence that got orphaned). `demoteImplausibleHeadings`
(`headingSanity.ts`) gained a second, independent signal alongside the length guard: a
heading-styled paragraph whose very next non-blank block (tolerating one blank spacer) is a
figure/table caption label (reusing `FIGURE_LABEL_RE`/`TABLE_LABEL_RE` from `captions.ts`) or an
image itself is demoted regardless of length. **Caught a self-inflicted bug while writing the
fix:** the first version's "skip one blank spacer" check used `blockText(b) === ''` to detect a
blank paragraph, but an image paragraph *also* has no `<w:t>` text — so it misidentified the
image itself as a blank spacer to skip past, walked one block too far, and never demoted
anything. Fixed by excluding image paragraphs from the blank check. +5 tests (11 total in
`headingSanity.test.ts`).

Server suite **359 green** (up from 350), tsc clean. `PLAN.md` updated (sumário + pré-textual
bullets). Bugs 2 and 3 are shipped fixes; bug 1 is diagnosed but open — needs a design decision
on how to split a merged capa/folha region by page boundaries rather than year-line count.

### 2026-07-02 (later 2) — Capa vertical centering, replacing the fixed-spacing hack that misplaced page breaks

Reported: exported PDFs sometimes had page breaks landing in the wrong place around the pré-textual
front matter. Root cause was `applyCoverYearBottom` (previous session) — it pushed the capa's city/year
line to the bottom of the page with a **fixed** 5040-twip `spaceBefore`, a constant tuned against one
content height. A longer or shorter capa (different institution-name/title line count) made that push
too much or too little, landing the break on the wrong page.

**First attempt (didn't survive empirical verification):** OOXML's textbook fix for "distribute a
page's content vertically regardless of length" is a section-level `<w:vAlign w:val="both"/>` (Word's
native "justify vertically" page property) — give the capa its own section break, clone the document's
page size/margins, add `vAlign`. Spec-correct, and Word would render it right. But built a real
synthetic capa, ran it through the actual `docxToPdf.ts` (LibreOffice 26.2 headless) export path, and
rendered the PDF to a PNG for direct visual inspection: **LibreOffice silently ignores `vAlign` entirely**
— identical top-clumped output with `both`, `center`, and `bottom`, tested on both a mid-document section
break and the document's own single/final section. This would have shipped a no-op fix.

**Working fix:** LibreOffice DOES honor **table-cell** `vAlign` (`<w:tcPr><w:vAlign>`) — confirmed
empirically the same way. `applyCoverVerticalDistribution` (`preTextual.ts`) now collapses the capa's
paragraphs into one borderless, full-page-content-height table cell with `vAlign="center"`; the cell's
exact width/height comes from the guideline's own page size/margins (no constant to tune). Verified
end-to-end: built a synthetic capa + resumo + body through Step A → pré-textual detection →
`applyCoverVerticalDistribution` → `zipDocx` → `docxToPdf`, rendered to PNG — capa content is vertically
centered on page 1, page 2 starts correctly at the resumo, page count correct (2).

**Trade-off, stated explicitly:** this centers the capa as one block, not the true ABNT 3-zone layout
(institution top / title middle / city+year bottom) — that needs per-field classification of the capa's
lines, which is the "detect and confirm" work already tracked as future scope in
`business_decisions/pretextual-elements.html`. Centering is a real improvement over the old top-clumped
bug without committing to that larger feature.

**Architecture note — this pass MUST run last.** Collapsing N capa paragraphs into 1 table block shifts
every later block index, so it cannot run in its old early pipeline slot (right after
`applyPretextualPageBreaks`) without corrupting `Step D`'s `bodyStartIndex`, the Step C/D reference
region, and Step P's fresh `detectPretextual` re-scan (which specifically needs the capa still as flat
paragraphs to recognize it as `capa` at all — `blockText` can't see into a `<w:tbl>`). Moved to the very
end of `processFormatting.ts`, after Step P, using a **fresh** `detectPretextual(workingDocXml)` call
rather than the early `pretextual` variable. `applyCoverYearBottom` is deleted (no callers, no test
coverage). 3 unit tests rewritten in `preTextual.test.ts`; server suite **350 green**, tsc clean.
`PLAN.md` updated (Onboarding Flow → pré-textual formatting bullet).

### 2026-07-02 (later) — Sumário generation bugfix: entries overflowing the page + body prose leaking into the TOC

A real upload surfaced two bugs in the sumário rebuild landed earlier the same day (screenshot: a TOC
entry justified/hyphenated across multiple lines with dots trailing off the page, and a full artist
biography paragraph appearing as a TOC row).

**Root causes, both in `sumario.ts`:**
1. `buildTocEntry` emitted a bare `<w:p>` with no `w:pStyle`, so every new entry fell back to the ABNT
   body style (`w:jc="both"`, 1.25cm first-line indent) — a short title got justify-stretched and wrapped,
   and the trailing dot-leader tab landed on the wrapped line, past the page margin.
2. `buildSumario` trusted any `Heading1–3`-styled paragraph unconditionally. The source doc had a
   paragraph styled `Heading3` that was really a full biography (the author likely typed "BEATRIZ
   MILHAZES" as a heading, hit enter, and kept typing the bio without switching back to Normal) — it got
   swept whole into the sumário.

**Fixes:**
- `buildTocEntry` now stamps `<w:suppressAutoHyphens/><w:ind w:left="…" w:firstLine="0"/><w:jc w:val="left"/>`
  explicitly on every entry, so it can no longer inherit body justification/indent regardless of guideline.
- New deterministic pass `demoteImplausibleHeadings` (`server/src/lib/formatting/headingSanity.ts`):
  clears the Title/Heading1-6 style off any paragraph whose text exceeds `MAX_HEADING_CHARS` (200 — new
  shared constant in `blocks.ts`, previously a private `sumario.ts` constant). Wired into
  `processFormatting.ts` right after Step B / before pré-textual detection and Step D. This had to be a
  new deterministic pass — Step D's own docstring states it only ever *promotes* misclassified body text to
  a heading, never demotes, by design (a bad AI demotion could silently strip a real heading and corrupt
  the whole outline). `buildSumario` also kept its own length guard as an independent second layer.
- Uses the previously-dead `clearHeadingStyle` helper in `blocks.ts` (existed, was unused until now).

**Tests:** `sumario.test.ts` (+2: justify/indent reset, long-heading skip), new `headingSanity.test.ts`
(7 tests: demotes over-long Heading/Title, leaves real headings/non-heading paragraphs/list items alone,
idempotent). Full server suite: **350 passed, 3 skipped**. `tsc --noEmit` clean.

**Still open / not addressed this session:**
- Real page numbers in the sumário (still a blank dot-leader tab — needs a TOC field or pagination render
  pass, as originally planned in `PLAN.md`).
- REFERÊNCIAS (and any other `ReferencesHeading`-styled post-textual section) is never scanned into the
  sumário — `buildSumario` only looks at `Heading1-3`. Per ABNT NBR 6027 REFERÊNCIAS is a mandatory
  sumário entry. Not yet fixed — flagged during review, not part of the user's reported bug.
- A latent, pre-existing bug (not introduced this session, but made more likely to trigger by
  `buildSumario` sitting in the pipeline): Step P's references-exclusion boundary
  (`processFormatting.ts`, `region?.headingIdx`) is computed once at Step B time and never recomputed,
  even though `buildSumario` (and `detectAndInsertPlaceholders`) can change the total block count
  afterward — if the sumário's entry count differs from what it replaced, every block index after it
  shifts, so `refStart` can point at the wrong paragraph by the time Step P runs. Not fixed — needs a
  fresh `locateReferences`/`autoLocateReferences` call right before Step P, mirroring how `coverExclude`
  is already recomputed fresh there.
- No browser-verified end-to-end run (this is backend DOCX-XML generation logic, not observable through
  the Vite dev server preview — verification was via the unit suite + manual trace against the reported
  screenshot).
- **Heads up:** `web/src/lib/pretextual.ts` (client mirror, drives page-selection/lauda billing) was NOT
  touched — it doesn't build the sumário, only detects the section boundary, so it's unaffected by this fix.

### 2026-07-02 — Caption formatting pass + empty-source detection + sumário generation

**Caption formatting pass (continued from previous session).** `formatCaptions` (`captions.ts`) now
does a comprehensive formatting pass beyond style-stamping:

- **Dot → colon normalization** — `normalizeLabelDot` rewrites `Figura N.` → `Figura N:` (and `Tabela N.`)
  in the first `<w:t>` run, preserving sub-number dots (`12.1.` untouched). `normalizeSourceDot` handles
  `Fonte.` → `Fonte:`. Both operate on XML-level text so run structure is untouched.
- **Embedded caption/source splitting** — `splitEmbeddedCaption` detects image paragraphs where an extra
  `<w:r>` in the same `<w:p>` carries the caption label or source text (Google Docs export pattern).
  Splits into three paragraphs: `[Caption-styled label] + [image-only <w:p>] + [Caption-styled source]`,
  normalizing the dot separator in the process. Verified on real document (`Copia_de_00_TCC_VivianDominot.docx`):
  one split, 402 → 403 blocks, 0 phantom placeholders.
- **Table styling loop** — scans `<w:tbl>` blocks and applies `normalizeLabelDot(TABLE_LABEL_DOT_RE)` +
  Caption style + `keepWithNext` to the caption above, and `normalizeSourceDot` + Caption style to the
  source below. `TABLE_LABEL_RE` and `isTableBlock` exported from `captions.ts`; `missingInputs.ts`
  imports them (removing local duplicates).
- `FIGURE_LABEL_RE` and `TABLE_LABEL_RE` now include `.` in the separator character class so
  `Figura 12.` is recognized as a caption, not flagged as missing.

**`missingInputs.ts` improvements.**
- `nextBlockStartsAnotherLabel` guard — prevents a phantom "missing source" placeholder from being
  inserted between the last uncaptioned image in a stack and the next figure's own caption label.
- `ownText` guard — if the image paragraph itself carries embedded label/source text (as a run),
  skip the placeholder for that direction.
- **Empty source detection** — new `isEmptySourceText` helper + `replaceAt` map. When
  `nearestCaptionLine` finds a "Fonte:" (or "Fonte.") line that has no content after the separator,
  that block is **replaced in-place** with a red placeholder paragraph (block count unchanged) rather
  than being treated as a valid source. Works for both figure and table sources. 3 new tests.

**Sumário generation.** New `sumario.ts` `buildSumario(documentXml, pretextual)` runs deterministically
after Step D in the formatting pipeline:
- Finds the `sumario` pré-textual section from `PretextualResult`.
- Scans body blocks (`i >= bodyStart`) for `Heading1`/`Heading2`/`Heading3` styled paragraphs.
- Generates a TOC entry per heading: H1 bold + flush left, H2 indented 709 twips (1.25 cm), H3
  indented 1418 twips, all with a right dot-leader tab stop at 9072 twips. Page number intentionally
  blank (tab present, no number).
- Packs all new entries into the first existing content slot; deletes excess old content blocks via
  empty-string `byIndex` entries; or appends after the label block if the sumário had no content.
- After the rebuild, `appendixStart = locateAppendixStart(workingDocXml)` is recomputed (block count
  may shift); `captionFreezeAt` uses the fresh index.
- 8 unit tests; exported via `formatting/index.ts`.
- **Still open:** page numbers (require a rendering/pagination pass); no browser end-to-end yet.

Server suite **337 passing** (3 evals skipped). `tsc` clean.

### 2026-06-29 — Multi-line caption detection + sumário heading duplicate fix + scroll-to-placeholder

**Multi-line captions.** Some captions span multiple paragraphs (label + 1–2 continuation lines above the image). The previous scan only grabbed the first non-blank paragraph above the image, missing the figure label when a continuation line came first. New `findCaptionsAbove(blocks, imageIdx, stopAt)` in `captions.ts` uses a 3-phase scan: Phase 1 skips blanks (up to `MAX_CAPTION_GAP`) to find the first text; Phase 2 returns immediately if it's the figure label; Phase 3 scans up to `MAX_CONTINUATION_LINES` (2) additional consecutive non-blank paragraphs looking for the label — a blank line, another image, or a table stops the scan. Returns indices in document order; `formatCaptions` stamps each as `Caption`. Four new tests (multi-line tagged; image hard-barrier; continuation-count exceeded; blank stops scan). Server suite **311 green** (was 308).

**Sumário heading duplicates — four-layer fix.**
- `blockText` (`blocks.ts`): `<w:tab/>` was silently dropped, turning `"1 INTRODUÇÃO<tab>5"` into `"1 INTRODUÇÃO5"` which passed `isBodyHeading`'s digit-prefix check and set `bodyStart` inside the sumário. Now replaces `<w:tab/>` with a space before extracting `<w:t>` content, so `"1 INTRODUÇÃO 5"` passes `isTocEntry`'s trailing-space-digit pattern instead.
- `isBodyHeading` (`preTextual.ts` + `pretextual.ts`): removed the `^introdu[çc][ãa]o$` special case that fired on manually-typed sumário entries without page numbers.
- `chunkHeadings` (`stepD.ts`): explicitly filters out `TOC1`/`TOC \d`-styled paragraphs as defense-in-depth.
- `suppressFirstHeadingPageBreak` (`processFormatting.ts`): now skipped when pré-textuais exist (`pretextual.bodyStart !== 0`), so INTRODUÇÃO keeps its own page break.

**Scroll-to-placeholder.** `DocxViewer` (`ProjectDetailPage.tsx`) converted to `forwardRef`, exposing `scrollToPlaceholder(allPending, target)`. Sorts inputs by `insertedAt`, walks the preview DOM with a `TreeWalker` collecting red text nodes in `PLACEHOLDER_TEXTS`, calls `scrollIntoView({ behavior:'smooth', block:'center' })` at the target's position. Each pending-input textarea fires it on `onFocus`.

### 2026-06-28 — Folha de rosto alignment + pré-textual section page breaks

- **Folha de rosto alignment.** `applyFolhaRostoAlignment` (preTextual.ts): within each folha de rosto section,
  scans block text for NATUREZA_RE / ORIENTADOR_RE to locate the "apresentada como requisito parcial…" + orientador
  block and stamps it with a new `FolhaRostoNatureza` paragraph style; all other folha blocks (author, title, city,
  year) get `CoverCentered`. If no natureza text is found, everything is centered. `FolhaRostoNatureza` style added to
  `rewriteStyles.ts` (and `guidelines.ts`): left-aligned, `w:ind w:left="4536"` (8cm = midpoint of A4 16cm text area),
  body font/size, no bold/caps. Wired in the orchestrator after `applyCoverAlignment`.
- **Section page breaks.** `applyPretextualPageBreaks` (preTextual.ts): stamps `<w:pageBreakBefore/>` onto the pPr of
  the first paragraph of every section[1+] (skips section[0] — no break before the very start). Idempotent (guarded
  against double-add). Composes correctly with `applyPretextualHeadings`: a RESUMO heading gets both the heading style
  and the page break. Added fourth in the orchestrator chain (headings → cover → folha → pageBreaks). Does not insert
  new blocks, so absolute block indices stay stable.
- Tests: `applyFolhaRostoAlignment` (correct/no natureza/no-op), `applyPretextualPageBreaks` (multiple sections,
  idempotency, composition), and `FolhaRostoNatureza` style assertion in `rewriteStyles.test.ts`. Server **307 green**,
  3 skipped.

### 2026-06-26 (later 3) — Capa centered

`applyCoverAlignment` (preTextual.ts) stamps every capa paragraph with a new `CoverCentered` paragraph style
(`COVER_STYLE`, defined in rewriteStyles.ts): centered, no indent, body font/size, NOT bold/caps — so an
author's run-level bold/larger title survives as a direct run override. Runs after Step B + `applyPretextualHeadings`
in the orchestrator. Only `capa` is centered (CENTER_KINDS); folha de rosto is deliberately left out because its
natureza note is offset to the right. Tests: `applyCoverAlignment` cases in `preTextual.test.ts` + a `CoverCentered`
style assertion in `rewriteStyles.test.ts`. Server suite **298 green** (then 301 with all caption/cover tests).

### 2026-06-26 (later 2) — Caption detection skips blank lines (no spurious placeholder)

Real-doc bug: an author's "Figura N — …" caption sitting a blank line or two ABOVE the image (not strictly
adjacent) was missed — the caption pass keyed only on the immediate neighbour (`i-1`/`i+1`), so the placeholder
pass inserted a red "[inserir legenda da figura]" right below the real caption.

- `captions.ts`: new `nearestCaptionLine(blocks, start, dir, stopAt)` walks up/down skipping up to
  `MAX_CAPTION_GAP` (3) **blank** paragraphs (never real text, never across a table/another image), returning
  the first text paragraph. `formatCaptions` uses it for both the figure label above and the source below.
- `missingInputs.ts`: `captionPresent(blocks, from, dir, labelRe, stopAt)` (replaces the old `captionOccupied`/
  `sourceOccupied`) uses the same window, so no placeholder is inserted when the caption/source is present a
  blank line away. Style-check backstop kept (formatCaptions runs first and styles it).
- Body text between the label and the image still blocks the match (we skip blanks only), so ordinary prose is
  never grabbed. Tests added in both suites; server **296 green**.
- **Note:** the caption is styled where it is — the blank line between it and the image is left in place (not
  closed). Pulling it adjacent (removing the intervening blanks) is a possible follow-up.

### 2026-06-26 (later) — Pré-textual formatting (server) + slicing-consistency fix

Built on the detection work below.

- **Slicing consistency (regression fix).** Changing only page selection's lauda numbering desynced it
  from checkout/recovery (which still folded pré-textuais into Lauda 1) → wrong slice + dropped front
  matter. `web/src/lib/laudas.ts` now owns it: `analyzeDocument(blocks)` (detect + `computeLaudas(bodyStart)`)
  and `uploadKeepSet(blocks, selectedLaudas)` (always retains pré-textual blocks so the front matter reaches
  the server). `CheckoutPage` + `ProjectDetailPage` re-slice use them. Web suite **45 green**.
- **Server-side formatting.** `server/src/lib/formatting/preTextual.ts` mirrors the web detector on the
  document XML. `applyPretextualHeadings` stamps the unnumbered-title style (centered/bold/UPPERCASE — reuses
  `REFERENCES_HEADING_STYLE`) on each labeled heading (RESUMO/ABSTRACT/SUMÁRIO/listas/agradecimentos/errata/
  folha de aprovação). `processFormatting` runs it after Step B and passes `bodyStart` → Step D
  `bodyStartIndex`, so the front matter is excluded and no cover/abstract line is promoted to a numbered
  heading. `preTextual.test.ts` + a Step D exclusion case; server suite **290 green**. abnt.md §10 note updated.
- **Step P cover exclusion.** `coverBlockIndices(sections)` (capa, folha de rosto, folha de aprovação) →
  Step P `excludeIndices`, so the identity pages are never "corrected" (names/institution/title) while
  resumo/abstract prose IS proofread. Detected fresh in the Step P block so it also covers proofreading-only
  mode. `stepProofread.test.ts` + `coverBlockIndices` test. Server suite **292 green**.
- **Natureza false-positive fix.** The folha-de-rosto matcher used to accept bare thesis-type words
  (tese/dissertação/monografia), which appear in normal body prose — a stray "dissertação" in a chapter
  wrongly flagged whole chapters as front matter (dropped from laudas + formatting). Tightened to require the
  actual presentation phrase ("apresentada a/ao… requisito parcial… obtenção do título/grau") in both
  detectors; regression tests added. A doc with NO pré-textuais (or one merely mentioning a thesis word) is
  now a clean no-op: `{sections:[], bodyStart:0}`, every block billed/formatted as before.
- **Still open:** capa/folha full vertical distribution (needs detect-and-confirm field step), Sumário regeneration. No browser end-to-end yet.

### 2026-06-26 — Pré-textual element detection + "Pre text elements" classification

New branch **`pretextual-detection`** (off `feature/docx-page-detection`). First slice of the ABNT
pré-textual work (decision record: `business_decisions/pretextual-elements.html`).

- **Detector** — `web/src/lib/pretextual.ts` (`detectPretextual`, text-only so it runs on both
  `getDocxBlocks` and the rendered docx-preview DOM). Labeled sections (resumo, abstract, sumário,
  listas, agradecimentos, errata, …) via anchored regex; cover pages (capa, folha de rosto) via
  position + year-line / natureza-note / orientador anchors. Returns `{ sections, bodyStart }`.
  `bodyStart` is found as the first real body heading *after* the last pré-textual signal, so sumário
  TOC entries (rejected by `isBodyHeading`) never beat the real "1 INTRODUÇÃO".
- **Billing** — `computeLaudas` gained a `bodyStart` arg: the pré-textual region `[0, bodyStart)` is
  excluded from laudas (not billed/sliced), block indices stay absolute. No-front-matter docs → `bodyStart 0`,
  unchanged behaviour.
- **UI** — `PageSelectionPage`: detected sections render in a separate **"Pre text elements"** group at
  the top of the left checklist (amber, non-selectable, with a "not counted as laudas" hint); the center
  preview labels each section + the body's "Lauda 1" boundary with recolored dividers. i18n added to all
  three locales (`pretextual.*`).
- **Tests** — `pretextual.test.ts` + new `bodyStart` cases in `laudas.test.ts`. Full web suite **43 green**;
  tsc + eslint clean on the changed files.
- **Not browser-verified end-to-end** — the panel needs an authenticated upload to reach page selection;
  core detection is covered by deterministic unit tests. Capa↔folha split is heuristic; the field-level
  detect-and-confirm step (and server-side formatting of these sections) is still future work.

### 2026-06-24 (later) — Accented title truncated on Google Docs URL upload

URL upload fetched the `.docx` fine but the project title lost everything from the first accent (e.g.
"Avaliação…" → "Avalia…"). Two causes in `documents.ts` `/fetch`:
- **Filename extraction picked the wrong param.** Google's Content-Disposition carries BOTH
  `filename="..."` (plain ASCII, accents stripped by Google) AND `filename*=UTF-8''...` (RFC 5987,
  percent-encoded, accents intact). The old regex `filename\*?=` matched the **plain** one first → the
  mangled ASCII name. New `filenameFromDisposition()` helper **prefers `filename*`**, decodes it
  (try/catch on bad `%`), falls back to plain, always returns `.docx`. +6 tests (`documents.test.ts`).
- **Header re-encoding.** HTTP header values are latin-1, so even a correct accented name is unsafe sent
  raw. The route now percent-encodes `X-Filename` and uses `filename*=UTF-8''` + an ASCII fallback for
  `Content-Disposition`. Clients (`GetStartedPage`, `ProjectDetailPage`) decode via the new shared
  `web/src/lib/filename.ts` `decodeFilename()` (graceful for an older non-encoded server).
- Server **285** passing, tsc + web build clean.

### 2026-06-24 — Reasoning cap on Step C/D (NoObjectGeneratedError: finishReason length)

A real upload (front-matter-heavy thesis) failed **both** Step D and Step P with
`NoObjectGeneratedError` / `finishReason: 'length'`. The dump showed the cause: Step D on **ultra**
spent **7851 reasoning tokens vs 341 text tokens** — it deliberated every ambiguous cover/TOC line
(title vs body vs heading) and burned the entire 8192 `maxOutputTokens` on chain-of-thought, never
emitting the JSON. Both failures are non-fatal (deterministic A/B kept), but the doc got no AI
heading/proofreading work.

Root cause was a **missing knob**: only Step P passed `reasoning.effort` to OpenRouter; Step D and
Step C passed none, so their reasoning models ran uncapped. Fix:
- **`config.ts`** — added `headingReasoningEffort` (`AI_HEADING_REASONING_EFFORT`) and
  `referenceReasoningEffort` (`AI_REFERENCES_REASONING_EFFORT`), default **low**, mirroring Step P.
- **`headingDecider.ts` / `referencesDecider.ts`** — now always send `providerOptions.openrouter.reasoning
  = { effort }` (previously the whole `providerOptions` block was gated behind `AI_PROVIDER` being set,
  so even the provider pin was skipped when empty). Provider pin stays optional inside it.
- **Output budgets raised** (combined reasoning+output, so they must clear reasoning + the JSON):
  `AI_MAX_TOKENS` default 8192→**16384**, `AI_PROOFREAD_MAX_TOKENS` 4096→**8192**. The `.env.example`
  had `AI_MAX_TOKENS=2048` (guaranteed failure on a reasoning model) — corrected.
- **Live `.env`** updated: `AI_MAX_TOKENS` 8192→16384 + the two new effort knobs (=low). **Restart the
  server.**
- +3 config tests; server **274** passing, tsc clean.

**Structural root cause (fixed same day) — chunks were char-bounded only, so one giant call.** Step D/P
chunked purely by `maxCharsPerChunk` (3000). Front matter / TOC is many *short* lines (~30 chars each), so
**all ~32 packed into a single chunk** — the model classified the whole front matter in one call, which is
what made it over-reason. Step C already had this lesson (`referencesMaxEntries=3`); D and P never got the
equivalent. Added a **paragraph-count cap**: `maxBlocks` on `chunkHeadings`/`chunkProofread` (default 12,
config `maxBlocksPerChunk` / env `AI_MAX_BLOCKS_PER_CHUNK`), threaded from `processFormatting`. A chunk now
flushes on chapter boundary OR char budget OR 12 paragraphs — so the front matter splits into ~3 calls
instead of one. This is the real fix; the effort cap + raised budget are belt-and-suspenders. +3 tests
(stepD/stepProofread count-cap, config). Live `.env` updated (`AI_MAX_BLOCKS_PER_CHUNK=12`). Server **277**
passing.

**Step P split-and-retry resilience (2026-06-24 later).** On long docs (60+ pages) Step P still hit
`finishReason: length` on individual chunks, and a single failing chunk **discarded the entire pass** —
`stepProofread` looped `await decider.proofread(chunk)` with no try/catch, so one throw propagated to the
orchestrator's non-fatal catch and lost all proofreading (more chunks = higher odds one fails = worse on
long docs). Fix: `proofreadResilient` wraps each chunk — on a decider throw it **splits the chunk in half
and retries each half as its own AI call** (recurses), so an oversized/over-reasoned chunk becomes several
tractable ones; a single paragraph that still fails is skipped (keeps deterministic text) and the rest of
the document is unaffected. So Step P now self-subdivides into more calls exactly when needed. +2 tests
(split-retry, single-block skip); server **279** passing. (Step D/C still abort-on-throw — same pattern
could be applied there if they start failing; not done yet.)

**Deeper recommendation (not done):** every one of these incidents (nano/super/ultra, Steps C/D/P) is a
*reasoning* model over-thinking a structured-JSON task. The bulletproof cure is a **non-reasoning instruct
model** for these extraction/classification passes — no chain-of-thought to blow the budget. Would need a
model pick + a gated eval. Effort-capping + the count cap + split-retry are the stopgap; if a pass still
truncates, drop its reasoning effort to `minimal`/`none` or lower `AI_MAX_BLOCKS_PER_CHUNK`.

### 2026-06-23 (later) — Stamp explicit heading size/bold/caps (Google Docs renders headings wrong)

Reported: the processed `.docx` looks right in the app preview (and Word/LibreOffice), but on upload to
**Google Docs** headings render **smaller** and lose their **uppercase** — even though GDocs' own
properties panel shows the right font/size. Same root cause as the font quirk (later 9/10): GDocs remaps
Word's built-in `Heading1/2/3` styles to its own and **discards the inherited style rPr**, so the
style-level `<w:sz>` / `<w:caps>` / `<w:b>` Step A wrote are dropped. `setRunFonts` already fixed the
*family* by stamping it on each run; size/bold/caps were still style-only.

Fix mirrors `setRunFonts`: new `setHeadingRunProps.ts` → `setHeadingRunProps(documentXml, spec)` stamps
the look (`<w:sz>/<w:szCs>`, `<w:b>/<w:bCs>` if bold, `<w:caps>` if upper) **directly on every run inside
a `Title` or `Heading1/2/3` paragraph**, stripping any stale bold/caps/size first so the spec values win
(e.g. an H3 the source bolded is normalized). Title → bold + caps + **body** size (ABNT título); headings
→ per-level look + heading size. Runs **right after `setRunFonts`** (so the props land just after the
`<w:rFonts>` it adds → CT_RPr order stays valid: rStyle, rFonts, b, bCs, caps, sz, szCs). Formatting-only.
Kept **non-destructive** (`<w:caps>` display, text untouched) to match Step A. The custom `ReferencesHeading`
+ `Caption` styles are NOT stamped — GDocs honors custom styles, only built-ins (`Title`/`Heading*`/`Normal`)
get remapped. +10 tests; server **271** passing, tsc clean.

**Heading 1 confirmed correct in Google Docs (2026-06-23 later).** Title was still wrong on the first
pass because the stamp only covered `Heading1/2/3` — extended it to `Title` (same built-in remap). Re-test
the Title in GDocs after reprocessing.

**Casing caveat still stands:** `<w:caps>` is the uncertain part — GDocs has spotty support for the caps
*toggle* even as direct formatting (H1 came out right, so it's holding so far). **If any casing is still
wrong, the fallback is to literally uppercase the `<w:t>` text** for upper-case styles (bulletproof across
renderers; handle XML entities when uppercasing). Not done yet — non-destructive caps first.

### 2026-06-23 — File auto-deletion cron

`projects.delete_files_at` was stamped at checkout (30 days out) but nothing acted on it. Built the
sweep server-side.

- **Core** — `server/src/lib/cleanupExpiredFiles.ts`. `cleanupExpiredFiles(client?, now?)` queries
  `projects` where `delete_files_at < now()` AND `files_deleted_at is null`, and for each removes
  `original_file_path`, `processed_file_path`, and the derived `.pdf` (processed path, `.docx`→`.pdf`)
  from the `projects` storage bucket, then stamps `files_deleted_at`. The row itself is **kept** (order
  history / dashboard); only the binaries go. Non-fatal per project — a storage `remove` failure is
  recorded in `errors` and the row is **left unstamped** so the next run retries it. `client` is
  injectable (structural `CleanupClient` interface) and lazy-loads the real `supabase` only when no fake
  is passed, so the unit test never imports `supabase.ts` (which throws without env). Returns
  `{ scanned, filesRemoved, projectsCleaned, errors }`.
- **Endpoint** — `POST /api/maintenance/cleanup-expired` (`routes/maintenance.ts`), `x-webhook-secret`
  guarded, idempotent. For an external scheduler (pg_cron http / n8n / cron).
- **Scheduler — Supabase pg_cron** (`server/sql/cleanup_cron.sql`). A daily `pg_net.http_post` hits the
  endpoint with the `x-webhook-secret`, both URL + secret read from **Supabase Vault** (not hardcoded in
  the job). Chosen over (a) a Deno Edge Function — the server already can't be serverless (LibreOffice
  PDF export), so decoupling from it buys little and would duplicate the logic in a second runtime + lose
  the vitest tests; and (b) an in-process `setInterval` — dies/resets on every deploy, no guaranteed
  fire. pg_cron keeps the one tested TS implementation and gets a real scheduler. **Deploy step (manual,
  once per env):** run `cleanup_cron.sql` in the Supabase SQL editor and create the two Vault secrets
  (`cleanup_endpoint_url`, `cleanup_webhook_secret`).
- 8 unit tests (`cleanupExpiredFiles.test.ts`); server **261** passing (3 evals skipped), tsc clean.
- **Endpoint live-verified end to end (2026-06-23).** Pre-check first confirmed 0 real projects were due
  (so the all-projects scan wouldn't touch real data), then an isolated fixture (`__cleanup_test__/…`
  storage objects + a throwaway project row dated yesterday) was created via service role. `POST
  /api/maintenance/cleanup-expired` returned `scanned:1, filesRemoved:3, projectsCleaned:1, errors:[]`;
  verified all 3 storage objects gone + `files_deleted_at` stamped; 2nd run scanned 0 (idempotent); bad
  secret → 401. Fixture + temp scripts torn down. **Still unverified:** the pg_cron→endpoint trigger
  itself (needs a deployed server URL + the Vault secrets). Note: the separate "deletion-warning email 7
  days before expiry" (PLAN Notifications) is still a distinct open item.

### 2026-06-21 (later 10) — Stamp explicit run fonts (Google Docs renders the wrong font)

Follow-up to later 9: even with theme + embeds fixed, Google Docs **still** rendered the wrong font for
body + headings, while the References heading was correct. Inspected the reprocessed file: it's provably
correct — LibreOffice renders **only Arial**; theme/docDefaults/Normal all Arial; runs carry no font.
Root cause is a **Google Docs import quirk**: it remaps Word's built-in styles (`Normal`, `Title`,
`Heading1/2/3`) to its own and substitutes its theme font, ignoring the *inherited* style font — but it
honors **direct run formatting** and **custom styles** (which is why `ReferencesHeading`, a custom style,
came out right).

Fix (chosen over renaming styles, which wouldn't fix the body and would break Word's outline/TOC): new
`setRunFonts.ts` → `setRunFonts(documentXml, fam)` writes an explicit `<w:rFonts ascii/hAnsi/cs=fam>` onto
**every run** (first rPr child, after any `<w:rStyle>`; replaces any existing). Runs **last** in
`processFormatting` (after Steps C/D/P, which add their own runs), formatting-only, using the family Step A
resolved (`resolvedFont`). Verified on the real file: all 51 runs stamped Arial, no corruption, LibreOffice
still pure Arial. +6 tests; server 253 passing, tsc clean. **Reprocess → re-upload to Google Docs to
confirm** (body + headings should now be Arial). Trade-off accepted: every run carries an rFonts (minor
size bump) — but it's the only thing Google Docs reliably obeys.

### 2026-06-21 (later 9) — Font packaging: rewrite theme + drop embedded fonts (Google Docs fix)

Reported: the processed `.docx` rendered a very different font in Google Docs even though the toolbar
showed the right family. Inspected a real processed file: `styles.xml`/`document.xml` were correctly
**Arial** everywhere, but two leftovers from the source (authored in Montserrat) survived — Step A only
touches styles/runs, not the packaging:
- `word/theme/theme1.xml` still had `majorFont=Cambria` / `minorFont=Calibri`. Google Docs resolves
  default + heading text against the **theme**, so it drew Cambria (serif) headings / Calibri body while
  the toolbar still said Arial.
- `word/fonts/*.ttf` (Montserrat) + `fontTable.xml` `<w:embed*>` refs + `embedTrueTypeFonts=1` remained,
  though nothing referenced Montserrat anymore.

Fix: new `fontPackaging.ts` — `rewriteThemeFonts(themeXml, fam)` repoints each theme's major/minor
`<a:latin>` to the resolved family (script-specific `<a:font>` fallbacks left alone), and
`normalizeFontPackaging(files, fam)` also strips the embed refs from `fontTable.xml`, deletes the
`word/fonts/*` binaries + `word/_rels/fontTable.xml.rels`, and removes the embed flags from
`settings.xml`. `applyStepA` now returns the resolved `font`; `processFormatting` calls
`normalizeFontPackaging(files, a.font)` right after Step A (formatting branch only — proofreading-only
docs keep the author's fonts). Verified on the reported file: theme major+minor → Arial, embeds gone,
binaries/rels deleted, flag off. +6 tests; server 247 passing, tsc clean. **Reprocess to apply.**

### 2026-06-21 (later 8) — Step D now classifies the appendix (references is a range, not a cutoff)

The appendix headings weren't being classified by Step D even after the appendix was "enabled".
Root cause: `chunkHeadings` used a single `refStartIndex` **cutoff** (`i < refStartIndex`), and in ABNT
order the document is body → References → Appendix — so the references heading sits *before* the
appendix, and the cutoff discarded everything after references, including the appendix.

Fix: `refStartIndex` now bounds only the **start** of the references region; new `appendixStartIndex`
re-includes the appendix. `chunkHeadings` keeps a block when it is **before references OR at/after the
appendix** (`beforeRefs || inAppendix`), so the references entries stay excluded but the appendix is
classified. `processFormatting` passes `appendixStartIndex: appendixStart ?? -1`. +1 test; server 244
passing, tsc clean.

Caveat: this lets the model *see* the appendix headings, but it may still leave a line like
`Apêndice 1 — Desenho técnico` as body if it reads like a caption (model judgment). A deterministic
"promote appendix item titles to a subheading" pass is the fallback if that proves unreliable — relates
to the `Apêndice N — …` paragraphs getting the body first-line indent.

### 2026-06-21 (later 7) — Step C: fix `&lt;`/`&gt;` in URLs + strip URL angle brackets

Reported: a reference URL came out as a literal `&lt;https://…&gt;`, and two otherwise-identical
references (one with `<url>`, one bare) formatted differently.

- **Root cause (escaping):** the Step C model sometimes returns a URL **pre-escaped** in its JSON
  (`&lt;…&gt;`). `renderSegments` then ran `escapeXml`, which escaped the `&` again → `&amp;lt;` →
  the document showed a literal `&lt;`. (`escapeXml` itself is correct single-escaping — `xmlText.ts`.)
- **Fix:** new `normalizeReferenceText` in `stepC.ts`, applied in `renderSegments` before `escapeXml`:
  (1) decodes the entities the model emits (`&lt; &gt; &quot; &#39; &amp;`), and (2) strips `< >` that
  merely wrap a URL — ABNT NBR 6023:2018 dropped them, and it makes `<url>` and a bare `url` format
  identically. Verified on the reported input: raw `<url>`, model-escaped `&lt;url&gt;`, and bare `url`
  all normalize to the same bare URL. +2 tests; server 243 passing, tsc clean.
- **Still open — surname casing (Bug B):** the same reference came out `dos, C.` vs `Dos, C.` — pure
  Step C **model non-determinism** (it title-cased `DOS`→`Dos` but left `dos`). A reliable fix needs a
  *deterministic* author-surname casing rule (e.g. UPPERCASE the surname), not the AI. Convention not
  yet decided (the long-standing Step C casing question).
- **Note:** Step P also escapes model text via `escapeXml` (`runs.ts`) — if the proofread model ever
  pre-escapes entities, it would hit the same double-escape. Not observed yet; scoped this fix to Step C.

### 2026-06-21 (later 6) — Image sizing: preserve author width, shrink only on overflow

Reported: an appendix image leaked off the right of the page in the processed-file preview. Root cause
was **the file itself** (the image is wider than the content area, so it overflows the page in Word/PDF
too — the preview just showed it faithfully; the `.docx-wrapper img { max-width }` clamp added earlier
is kept as defence-in-depth but docx-preview's `experimental` image rendering was escaping it). Two
prior decisions compounded it: `formatImages` skipped the appendix entirely, and elsewhere it *forced*
70%.

New `formatImages` policy (`imageLayout.ts`): **preserve each inline image's author-chosen width**
(guidelines have no image size; authors size figures deliberately) and **shrink only when it overflows
the page content width** — never enlarge. Removed `IMAGE_WIDTH_FRACTION` (and its barrel export). Runs
over the WHOLE document now (incl. appendix) — `processFormatting` calls `formatImages(doc, guideline)`
with no cutoff; caption/source insertion still stops at the appendix (`captionFreezeAt`). Centering of
the image paragraph is unchanged.

Verified with a script: a 9 000 000-EMU image in the body AND in the appendix both cap to the content
width (~5.76M EMU), while an 800 000-EMU image is left untouched. Updated `imageLayout.test.ts`
(shrink-oversized / preserve-small / preserve-fitting). Server 241 tests green, web build clean.
Follow-up: section-aware cap (the width still comes from the *first* `<w:pgSz>`, so a landscape page's
image is capped to the portrait width).

### 2026-06-21 (later 5) — Missing-file recovery flow

A paid order can land with `original_file_path: null` (the upload lives in volatile browser memory; a
payment-redirect reload / refresh can wipe it before `handleSuccess` uploads). Previously the pipeline
silently aborted at its null-path guard, leaving the project stuck at `pending` with no user signal.

- **New status `missing_file`** — `status.ts` (union, `normalizeStatus`, `STATUS_BADGE_VARIANT`),
  `badge.tsx` (red variant), dashboard active-count, all 3 locales (`dashboard.status.missing_file`,
  `project.recover.*`). DB `status` is free `text` (no enum/constraint) — no migration needed.
- **Detection** — `processFormatting`'s null-path guard now stamps `status: 'missing_file'` and calls
  `sendReuploadNeededEmail` (non-fatal, only when not already `missing_file`).
- **Email** — `sendReuploadNeededEmail` in `notify.ts` + `emails/reuploadNeeded.ts` (mirrors
  `projectReady`); copy makes clear there is **no re-charge**.
- **Recover endpoint** — `POST /api/processing/recover-file { projectId, path, fileName }` in
  `processing.ts`: owner-auth, refuses if the project already has a file, validates the path is under
  the project's own folder, stamps `original_file_path` + `original_file_name`, sets `pending`, and
  re-triggers `processFormatting`.
- **Re-upload UI** — for `missing_file` projects, `ProjectDetailPage` replaces the centre file viewer
  with a `RecoverUpload` container that mirrors GetStartedPage: a tab switcher between a local `.docx`
  drop zone and a Google-Docs **URL** fetch (`/api/documents/fetch`). Either path resolves to a File
  handed to `handleRecoverUpload`, which **re-slices the file to the paid laudas** (`selected_pages`,
  via `computeLaudas`/`laudaBlockSet`/`sliceDocxByLaudas` — the server never slices, so a full
  re-upload would otherwise process every lauda) → uploads to Storage client-side (same `.docx`→`.zip`
  scheme as checkout) → calls recover-file → reloads. `recovering`/`recoverError` state.
- **Testing scaffold** — `CheckoutPage.tsx` has a `SIMULATE_MISSING_FILE` toggle (currently **true**)
  that skips the post-payment upload so a project is created with a null path. **Revert before commit.**
- Web build + 35 tests green; server typecheck + 240 tests green. **Live-verified end to end on a real
  flow (2026-06-21)** — pay → `missing_file` → re-upload → processing resumed.

### 2026-06-21 (later 4) — Back button no longer returns to the paid checkout page

After a successful payment, `SuccessScreen` (rendered on `/checkout`) auto-redirected to the dashboard
with a plain `navigate(ROUTES.dashboard)` — a history *push*, so pressing Back from the dashboard
returned the user to the already-completed payment page. Changed it to
`navigate(ROUTES.dashboard, { replace: true })` so the paid `/checkout` entry is dropped from history;
Back from the dashboard now goes to the page before checkout, never the payment screen. Build clean.
**Not browser-verified** (needs a full Stripe checkout run). Uncommitted.

### 2026-06-21 (later 3) — Dashboard service badges + oversized preview images

- **Dashboard badges** (committed in `4556ec0`): a format+proofread project showed only one badge
  because `mapDbProject` kept `row.services[0]`. Now carries the full `services[]` and renders one
  `ServiceBadge` per service (canonical order formatting → proofreading), guideline on the formatting
  badge only; badge group `shrink-0 flex-wrap justify-end` so both stay visible at any width.
- **Oversized preview images (uncommitted):** in the lauda-selection preview (`PageSelectionPage`) and
  the processed-file viewer (`ProjectDetailPage`), docx-preview renders each `<img>` at its absolute
  author size (`<wp:extent cx>` EMUs → px) with no `max-width` clamp. On a narrow/laptop column the
  page reads small but a large author image stayed absolute → looked huge / overflowed the page. Fix:
  added `.docx-wrapper img { max-width: 100% !important; height: auto !important; }` to both previews'
  injected style blocks (`LAUDA_PREVIEW_STYLES`, `DOCX_PAGE_STYLES`). Build clean. **Not
  browser-verified** — both previews are auth-gated and need an image-bearing `.docx` carried through
  the upload flow. (Separate, deeper item still open: a real fit-to-width zoom on the lauda page —
  PLAN.md "Re-add document zoom controls to the lauda selection page".)
- **Server image sizing** — see "later 6" below; the preserve-author-width + shrink-on-overflow policy
  is now implemented. (Section-aware width for landscape pages is still a follow-up: the cap uses the
  *first* `<w:pgSz>`.)

### 2026-06-21 (later 2) — PDF export timing fix + chapter blank-page investigation

- **PDF export now waits for interactive inputs.** `processFormatting` used to export the PDF
  unconditionally at step 6b — including for `needs_input` docs, so the PDF baked in the red
  caption/source placeholders, and the `finalize-inputs` route (which re-uploads the corrected
  `.docx`) never regenerated it. Extracted a shared `exportPdfBeside(docxBuf, processedPath,
  projectId)` helper (exported from `processFormatting.ts`, non-fatal). It now runs only on the
  `complete` path in `processFormatting`, and again in the `finalize-inputs` route after the user's
  fills are applied — so the PDF always reflects the final document. **LibreOffice confirmed working
  locally** (`SOFFICE_PATH` set; `docxToPdf` produces a valid PDF).
- **Chapter "blank page" — INVESTIGATED, NOT yet fixed (need the real doc).** Hypothesis was a
  redundant author page break before a chapter title doubling with the `Heading1` style's
  `pageBreakBefore`. Built a LibreOffice reproduction harness (build doc → convert → count PDF pages):
  **none of 7 break shapes reproduced a blank page** — LibreOffice *collapses* a manual break adjacent
  to a `pageBreakBefore` heading, so the simple double-break theory is wrong. Added
  `removeRedundantChapterPageBreaks` (in `pageBreaks.ts`, wired after `suppressFirstHeadingPageBreak`,
  +6 tests) as legitimate **hygiene** — strips a standalone/trailing manual break before any chapter
  heading that already breaks via the style — but it did **not** change the page count in any repro, so
  it is **not** confirmed as the blank-page fix. The real cause is most likely **content-length
  dependent** (a chapter ending near the page bottom + trailing empty paragraphs + the forced break),
  which synthetic one-line content can't reproduce. **Next:** get a real processed `.docx` that shows
  the blank page and inspect the block structure around the boundary.
- Server **240** passing (3 evals skipped); `tsc` clean.

### 2026-06-21 (later) — Appendix is now formatted, proofread & billed (only image handling skipped)

Reversed the "freeze the appendix/annex entirely" rule. The post-textual section
(Apêndice / Anexo) is now treated like the rest of the document — it gets heading
hierarchy (Step A styles + Step D), text correction (Step Punct + Step P), and is
**billed as ordinary laudas**. The **only** thing skipped inside it is image handling.

- **Server** (`processFormatting.ts`): dropped the appendix cutoff from Step A
  (`applyStepA` no longer receives `appendixStart`), Step D (`refStartIndex` = references
  heading only), Step Punct, and Step P. Removed the now-unused `proofreadFreezeAt` and the
  `earliestCutoff` helper. The appendix cutoff (`appendixStart`/`imageFreezeAt`) now gates
  **only** the three image passes — `formatImages` (resize), `formatCaptions`, and
  `detectAndInsertPlaceholders` — so appendix images are neither rescaled nor given
  caption/source. The references locator still stops at the appendix (unchanged), so it is
  never mistaken for a citation list.
- **Billing/web** (`laudas.ts`): removed the appendix machinery entirely
  (`findAppendixBlock`, `looksLikeAppendixHeading`, the regex). `computeLaudas` counts the
  whole document; `laudaBlockSet` lost its `allBlocks`/force-keep param — the appendix is
  kept only when its laudas are selected, like any other content. `CheckoutPage.tsx` updated
  to the 2-arg `laudaBlockSet`. `laudas.test.ts` rewritten to the new behavior.
- `postTextual.ts` `locateAppendixStart`/`looksLikeAppendixHeading` are unchanged (still
  used for the image-pass cutoff + references bound); only the module docstring updated.
- Tests: server **234** passing (3 evals skipped), web **35** passing; `tsc`/builds clean
  both sides. (Web dropped 38→35: removed the 3 obsolete appendix-billing tests.)

### 2026-06-21 — Appendix detection (any casing) + Step P reasoning cap

Follow-ups on the 2026-06-20 work. **Uncommitted** in the working tree.

- **Appendix/annex detection now accepts every casing.** The first version required the heading to be
  UPPERCASE, which missed title-case "Apêndice A". `looksLikeAppendixHeading` (mirrored in
  `server/.../postTextual.ts` and `web/.../laudas.ts`) now uses a both-ends-anchored, case-insensitive
  pattern — the whole paragraph must be `label + optional enumerator (A, B, 1, II…) + optional "— título"`.
  The anchoring is what keeps it safe: an in-body mention ("o anexo A contém os formulários", "Anexo. Segue…")
  has extra prose or no separator, so it never matches. Matches `APÊNDICE A`, `Apêndice A`, `anexo i: mapa`,
  `Anexo 1`, etc. +3 server test groups; server 233 passing, web 38, builds clean.
- **Step P reasoning effort knob + model move to super.** A real Step P run on nano produced no JSON — the
  model poured 3.7k reasoning tokens of chain-of-thought into the output channel on a *tiny* (1141-token) chunk
  and hit the 4096 output cap before emitting anything. (Batching doesn't help: it bounds input, not the
  model's reasoning output.) Added an OpenRouter `reasoning: { effort }` knob in `proofreadDecider` — config
  `proofreadReasoningEffort` / env `AI_PROOFREAD_REASONING_EFFORT`, **default `low`** (Step Punct already does
  the mechanical punctuation, so light grammar is all that's left). Scoped to Step P. **`low` did NOT tame
  nano** (it under-honoured the cap), so `.env` `AI_PROOFREAD_MODEL` was moved to
  `nemotron-3-super-120b-a12b:free` — the same model that emits clean JSON on Step C. The reasoning knob stays
  (it also trims super's token use). **Restart the server.**
- **Appendix no longer leaks into the references region (Step B/C).** In continuous mode `autoLocateReferences`
  treated *every* paragraph after the "Referências" heading as a reference entry — including the appendix/annex
  that follows references — so Step B laid them out as citations and Step C sent them to the model (wasted AI).
  Both `autoLocateReferences` and the page-flagged `locateReferences` now bound the region at
  `locateAppendixStart`, so the appendix is excluded from the entry list. +1 test; server 234 passing.

### 2026-06-20 — Botched-merge fix, deterministic punctuation, interactive-input polish

Several pipeline fixes and improvements. **Only the first (the merge fix) is committed (`0641594`);
the rest is uncommitted in the working tree.**

- **Fixed a botched merge of the formatting pipeline** (committed). The `fc26444` merge had mixed two
  branch rewrites of `processFormatting.ts`, leaving undeclared variables (`workingDocXml`,
  `workingStylesXml`, `pending`, `region`), a stray `a.documentXml` that threw `ReferenceError: a is
  not defined` at runtime, and a `formatting/index.ts` barrel missing the `missingInputs` re-exports
  (`detectAndInsertPlaceholders`, `finalizeInputs`, `PendingInput`). Restored the coherent transform
  flow from the feature parent and re-added the barrel exports.
- **Step Punct moved into the proofreading service.** `applyPunctNorm` was wired into the *formatting*
  branch, so proofread-only docs never got it and format-only docs had their punctuation altered.
  It now runs at the **start of the proofreading step, before the AI pass** — see pipeline state above.
  Confirmed the AI receives the normalised text (Step P extracts its input from the same post-Punct XML).
- **Expanded the Step Punct rule set + added per-rule logging.** Added space-after-punctuation, smart
  quotes, spaced em dash, and number+unit non-breaking space, each with guards against false positives
  (URLs, decimals, numeric ranges, times). `applyPunctNormWithStats` returns counts; `processFormatting`
  logs them. +13 unit tests.
- **Interactive-input (caption fill) polish** in `missingInputs.ts`:
  - New `normalizeInputText(text, kind, ordinal)` cleans the user's typed caption/source before it goes
    into the doc. It runs the deterministic text rules (`normalizePlainText`), fixes the label casing
    (`figura`/`imagem`/`quadro` → `Figura`/`Tabela`), uses an em dash, and capitalises the first letter.
  - **Auto-numbering:** the figure/table number is **forced to the slot's true sequential ordinal**
    (already tracked in `PendingInput.ordinal`), so a user who retypes "3" for the 4th figure gets
    "Figura 4". Figures and tables count on separate sequences.
  - **Source lines now use 1.5 line spacing** (`<w:spacing w:line="360" w:lineRule="auto"/>`); captions
    stay single. Scoped to the interactive-input source line — pre-existing `Fonte:` lines styled by the
    deterministic `formatCaptions` pass are still single (open question if those should match).
- **`AI_REFERENCES_MODEL` corrected to super** in `.env` (was pinned to nano despite the in-file warning).
  Nano over-reasons and corrupts Step C JSON; super is enough. Only Step D headings need ultra.
- **Appendix / annex (Apêndice / Anexo) exclusion.** New `postTextual.ts` (`locateAppendixStart`)
  detects the first uppercase `APÊNDICE`/`ANEXO` heading. That block index is threaded as a cutoff into
  every per-block pass — `stripDirectOverrides` (via `applyStepA`), Step D, `formatImages`,
  `formatCaptions`, `detectAndInsertPlaceholders`, Step Punct, Step P — so the section is never
  proofread or reformatted, but it is **never removed** (ships intact in the `.docx`). Billing:
  `computeLaudas` stops at the boundary so the appendix isn't a billable lauda, and `laudaBlockSet`
  keeps the appendix range unconditionally so it survives slicing into the upload (CheckoutPage passes
  the blocks). Detection needs the heading typed UPPERCASE. Preview-UI marking of the frozen section is
  deferred. +13 server tests + 6 web tests.
- **PLAN.md:** added a new task — **missing-file recovery flow** (a paid order whose `original_file_path`
  is null because the volatile in-memory file was lost on a payment-redirect reload → email the user to
  re-upload, never re-charge); updated the model notes (references = super); logged the appendix feature.

Server suite **232 passing** (3 evals skipped), web **38 passing**, `tsc`/build clean both sides.
Restart the server to pick up the `.env` model change.

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

**Confirmed live — working properly:** the `needs_input` → fill → `complete` flow verified end to end on a real `.docx` (image/table missing a caption or source → user fills → stamps `complete`).



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
