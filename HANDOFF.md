# Project Handoff

> **Purpose.** A living snapshot of where this project stands, written for the next
> agent (or person) picking it up cold. Update it at the end of every working
> session: refresh the status, add a dated entry to the **Session log** at the
> bottom, and adjust **Open work** as things land. Keep it short and current —
> deep reference lives in the docs linked below, not here.

**Last updated:** 2026-06-08

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

- **Branch:** `refactor/codebase-cleanup` — **11 commits ahead of `main`, not yet merged.**
  Consider opening a PR to merge it.
- **Build:** web `npm run build` is **green** (it was broken before this session). Server `tsc` is green.
- **Tests:** web **32** passing (Vitest + Testing Library), server **63** passing.
- **Working:** auth, onboarding flow, checkout (Stripe), dashboard, project detail/viewer,
  and the DOCX formatting pipeline Steps A/B/D (the AI heading pass).

## Pipeline state (formatting)

- **Step A** (deterministic styles/overrides/margins) — built, tested.
- **Step B** (deterministic references layout) — built, tested.
- **Step C** (AI reference reformatting) — **NOT built yet.** Next pipeline feature; mirrors Step D's design.
- **Step D** (AI heading reclassification) — built, tested, and **confirmed working live** this session.
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
- **Gated live eval** for the AI path (no spend in CI):
  `cd server && set -a; . ./.env; set +a; RUN_AI_EVALS=1 npx vitest run src/lib/formatting/stepD.eval.test.ts`.
- Some `.md` files under `server/src/lib/formatting/` are **live code inputs**, not docs:
  `specs/abnt.md` is parsed at runtime and `prompts/heading-classification.md` is the Step D
  prompt. Don't "simplify" them casually.

---

## Open work / next steps

- [ ] Open a PR to merge `refactor/codebase-cleanup` → `main`.
- [ ] **Step C** — AI reference reformatting (same pattern as Step D).
- [ ] Migrate proofreading off n8n into the server.
- [ ] File auto-deletion cron (`projects.delete_files_at` is set but nothing acts on it).
- [ ] Switch `AI_MODEL` off the free model before relying on Step D in production.
- [ ] Optional cleanup: extract `SESSION_KEY` out of `GetStartedPage` into a light module so
      that route can also be lazy-loaded; add tests for the PDF/DOCX slicers.

---

## Session log

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
