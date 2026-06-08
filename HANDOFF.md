# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below, not here.

**Last updated:** 2026-06-08 (later session)

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

- **Branch:** `main` — the `refactor/codebase-cleanup` work has been **merged**. Working tree clean.
- **Build:** web `npm run build` is green. Server `tsc` is green.
- **Tests:** web **32** passing (Vitest + Testing Library), server **77** passing (+14 for Step C; 2 live AI evals skipped).
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer,
  and the DOCX formatting pipeline Steps A/B/C/D (both AI passes: reference reformatting + headings).

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
- Proofreading still runs on the old n8n webhook (not yet migrated to the server).

---

## Operational gotchas (read before debugging)

- **Run the server with `npm run dev`** (ts-node-dev on the source). `npm start` runs the
  compiled `dist/`, which is **gitignored and can go stale** — a stale `dist` that predated
  Step D was the cause of "Step D not working" this session. If you must use `npm start`,
  run `npm run build` first.
- **`server/.env` is loaded once at startup** (`dotenv/config`). After changing it (e.g.
  `AI_FORMATTING_ENABLED`), **restart the server** for the change to take effect.
- **Step D is behind `AI_FORMATTING_ENABLED=true`** and an OpenRouter key. An AI failure is
  **non-fatal by design**: it logs `[processFormatting] … Step D failed (non-fatal …)` and
  keeps the deterministic A/B result. So "no AI headings" can mean the flag is off, the call
  errored, or the doc simply had no plain-text headings to promote (Step D only *promotes*,
  never demotes).
- **Free model caveat:** `AI_MODEL` defaults to `openai/gpt-oss-120b:free`, which rate-limits.
  For reliability switch to a cheap paid model (and optionally pin `AI_PROVIDER`).
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

- [ ] **Confirm Step C live** against a real references fixture (set the eval's page flags), then
      promote off the free `AI_MODEL`. Code + unit tests are done; only the live check remains.
- [ ] Migrate proofreading off n8n into the server.
- [ ] File auto-deletion cron (`projects.delete_files_at` is set but nothing acts on it).
- [ ] Switch `AI_MODEL` off the free model before relying on Step D in production.
- [ ] Optional cleanup: extract `SESSION_KEY` out of `GetStartedPage` into a light module so
      that route can also be lazy-loaded; add tests for the PDF/DOCX slicers.

---

## Session log

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
