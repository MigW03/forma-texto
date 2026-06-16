# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below, not here.

**Last updated:** 2026-06-16

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
- **Build:** not verified on this branch yet (`npm run build` in `web/` to confirm).
- **Tests:** server **132** passing (2 AI evals skipped); web tests not re-run after lauda changes.
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer,
  the DOCX formatting pipeline Steps A/B/C/D (both AI passes: reference reformatting + headings),
  and the server-side proofreading pass (Step P) — proofreading is no longer on n8n.
- **Key change:** billing unit moved from pages to laudas (~300-word units). Only `.docx` files accepted
  now (PDF removed as input). See session log 2026-06-13.

## Pipeline state (formatting)

- **Step A** (deterministic styles/overrides/margins) — built, tested.
- **Step B** (deterministic references layout) — built, tested.
- **Step C** (AI reference reformatting) — **built, unit-tested, and validated on the free
  model** (mirrors Step D's design). Returns `[{ i, segments }]`; deterministic code renders
  runs and splices over each entry, keeping Step B's `<w:pPr>`. Behind `AI_FORMATTING_ENABLED`.
  **Key finding:** the first version returned 0 emphasis not because the model was incapable but
  because the `reference-reformatting.md` prompt was too vague — it buried the bold rule and led
  with the "when unsure, return unchanged" escape hatch, so the weak model bailed on every entry.
  Rewriting the prompt (explicit per-source-type emphasis map: book→title, article→periodical
  name, etc.; a middle-emphasis article example; ban markdown chars in `text`) made the **free**
  `gpt-oss-120b:free` produce correct ABNT emphasis on all test entries. The decider also now
  accepts nullish `emphasis` (weak models emit `null`) and coerces it. **Still to confirm:** one
  real end-to-end upload (bold actually rendering in the output `.docx`).
- **Step D** (AI heading reclassification) — built, tested, and confirmed working live.
- **Step E** (re-zip / upload / stamp / email) — built.
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
- **AI model:** fallback (and current `.env`) is `nvidia/nemotron-3-super-120b-a12b:free`. Set
  in `server/src/lib/formatting/ai/config.ts` and `server/.env`. Override via `AI_MODEL` env var.
  `AI_MAX_TOKENS=8192` and `AI_MAX_CHARS_PER_CHUNK=3000` — reasoning models need the larger token
  budget or JSON truncates mid-response.
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

- [ ] **Confirm Step C live** — point the eval's `selectedPages`/`referencePages` at a real `.docx`
      with a references section and run `RUN_AI_EVALS=1 npx vitest run src/lib/formatting/stepC.eval.test.ts`.
      Confirm bold renders in the output `.docx`. Code + unit tests are done; live check only.
- [ ] **Merge `feature/docx-page-detection`** into main — build not yet verified.
- [x] ~~Migrate proofreading off n8n into the server~~ — done (Step P). Live-confirm on a real
      multi-page `.docx` upload (the inline eval fixture passed; one real end-to-end run pending).
- [ ] **Bug — references-formatting option shown without the formatting service.** In
      `web/src/pages/PageSelectionPage.tsx` the "this document has a references section" checkbox
      (and the format-references yes/no radio) is always enabled. It should only appear/be
      enabled when the user selected **formatting** as a service — formatting the references is
      a formatting-only action, irrelevant to a proofreading-only order. Gate the control on
      `services.includes('formatting')` (and make sure `references_pages` isn't set for a
      proofreading-only project; Step P auto-detects references regardless).
- [ ] File auto-deletion cron (`projects.delete_files_at` is set but nothing acts on it).
- [ ] Optional: add tests for the DOCX slicer (`docx-slice.ts`); extend test fixture with an image
      to confirm `formatCaptions` end-to-end on a real `.docx`.

---

## Session log

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
