# FormaTexto — Feature Plan

> Open items only. Completed work is not tracked here — see [`HANDOFF.md`](HANDOFF.md) for current
> state and `git log` for history. Mark an item `[x]` and move it out on completion; add new items in
> their own deliberate edit.

---

## Auth

- [ ] Delete account
  - Supabase admin API or Edge Function — requires server-side call

---

## Checkout & Payment

- [ ] Migrate to Checkout Sessions API (deferred)
  - Stripe recommends Checkout Sessions + PaymentElement over Payment Intents for new integrations. Would simplify PIX and future local payment methods. Not worth the rewrite now — revisit if PIX setup on the live account proves painful. Server changes in `checkout.ts`; frontend changes in `CheckoutPage.tsx` (swap `Elements`+`PaymentElement` for `CheckoutElementsProvider` from `@stripe/react-stripe-js/checkout`, confirm via `checkout.confirm`).
- [ ] PIX payment support
  - PIX removed from code (both `payment_method_types` on the server and `paymentMethodOrder` on the frontend) — needs to be enabled on the live Stripe account first (Settings → Payment methods), then re-add `payment_method_types: ['card', 'pix']` in `checkout.ts` and `'pix'` to `paymentMethodOrder` in `CheckoutPage.tsx`.
- [ ] Comprehensive free trial security test
  - Verify the trial cannot be abused: a user selecting multiple pages cannot get the free trial (backend must reject `pageCount > 1` on `complete-free-order`); a user cannot trigger a second free trial after the first is consumed (`trial_used_at` is stamped and re-checked server-side on every request); manipulating the client-side `isFree`/`isTrial` flags has no effect (eligibility is always re-verified in `checkout.ts`); a new account doesn't grant a second trial if the same payment method/identity is reused.
  - Note (2026-07-15): the discounted-order path currently depends entirely on the Stripe webhook landing (`trial_used_at` is only stamped from `payment_intent.succeeded`); the 1-page fully-free path is self-contained. Worth hardening with a client-side reconciliation fallback — discussed and deliberately deferred this session.

---

## Project Detail

- [ ] Show processing progress or estimated time
  - UI-only: status-based messaging, or backend-driven `progress` field added to `projects` table

---

## Notifications

- [ ] Improve email HTML templates
  - Templates live in `server/src/emails/`. Improve visual design: better spacing, branded header, footer with unsubscribe/legal note, responsive layout. Consider extracting a shared `layout.ts` wrapper. Currently using `onboarding@resend.dev` — swap `from` address to `noreply@formatexto.com` once domain is verified in Resend.
- [ ] Welcome email on sign-up
  - Triggered by Supabase auth webhook on new user creation. Brief onboarding email: explains the service, links to `/get-started`, reminds user of the free first page. Template in `server/src/emails/welcome.ts`.
- [ ] Order confirmation / receipt email
  - Triggered after payment succeeds. Body: services ordered, page count, guideline, amount paid, link to project page. Template in `server/src/emails/orderConfirmation.ts`.
- [ ] Respect notification preferences in backend
  - `notifications.ts` and future email senders should fetch `user_profiles.notification_preferences` before sending and skip if the relevant toggle is off. Currently all emails send unconditionally.
- [ ] In-app notification or badge for status change
  - Supabase Realtime on `projects` table, show toast or navbar badge
- [ ] File deletion warning email (7 days before expiry)
  - Triggered by a scheduled job. Query `projects` where `delete_files_at` is between `now()` and `now() + 7 days`, `files_deleted_at` is null, `processed_file_path` is not null, and the user hasn't downloaded (needs a `processed_file_downloaded_at` column, stamped on first signed-URL fetch/download click). Guard duplicate sends with a `deletion_warning_sent_at` column.

---

## Backend / AI Pipeline

- [ ] Processing queue — resumable after a restart, staggered to save infra cost
  - `processFormatting` is fire-and-forget in-process today; a server restart mid-job silently loses that job (no retry, no status update). Need a durable queue (Postgres table + polling worker, or a real queue service) so an in-flight job resumes after a restart, and so jobs process one/few-at-a-time instead of all firing concurrently. Related to but broader than the existing `processing_attempts` retry-cron (`retryPendingJobs.ts`), which only catches rate-limited jobs, not a dead process.
- [ ] Handle a source document that already has its own sumário/TOC
  - Common in real theses — the author already built a TOC before submitting. Need a reliable way to detect an existing sumário and either replace it cleanly or merge with the pipeline's own rebuild, without corrupting or duplicating it. Current `buildSumario`/`detectPretextual` logic assumes it's building the sumário from scratch; verify/harden against a pre-existing one.
- [ ] Guideline isolation — every formatting pass scoped strictly to the active guideline (post-MVP)
  - Audit that no ABNT-specific behavior leaks into APA/MLA/Chicago (and vice versa) as the app expands past Brazil-only ABNT. Post-MVP — launching ABNT-only first — but worth doing now in a separate branch if it doesn't cost quality or the launch timeline, since the pipeline was built ABNT-first and may have implicit ABNT assumptions baked into passes that are meant to be guideline-generic.
- [ ] Table formatting refinement (ABNT)
  - Apply ABNT table styling: the label/title above the table ("Tabela N — …"), the source note ("Fonte: …") below it, open horizontal borders with no vertical rules, and centered placement. Confirm and refine how tables are currently handled in the pipeline.
- [ ] Ficha catalográfica gets centered/distributed like the folha de rosto (bug)
  - The ficha catalográfica isn't a recognized pré-textual element (`preTextual.ts` has no matcher/kind for it). It sits after the folha de rosto text and before the first labeled section (RESUMO/etc), so `classifyPretextual` lumps it into the `folhaDeRosto` section (`blockStart..firstLabeled-1`). Consequences: `applyFolhaRostoAlignment` stamps `COVER_STYLE` (centered) on its paragraphs — user saw the ficha *title* centered in the exported PDF — and `folhaDeRosto` is in `DISTRIBUTE_KINDS`, so it also gets full-page vertical distribution. Fix: detect the ficha as its own section, exclude it from cover centering + `DISTRIBUTE_KINDS` (ABNT: boxed, left-aligned, on the verso of the folha de rosto). Detection is the hard part — the ficha often has NO clean title line (bare library-generated box), though the reporting user's doc apparently did. **Anchor the fix on a real `.docx` (user to share next session) — this heuristic family has a long works-on-fixture/fails-on-real history.**
- [ ] Surface `validateOutput` failures instead of only logging them; consider a narrow repair path
  - Today a validation failure (`validateOutput.ts`) reverts the project to `pending` and the specific issue (`code`/`message`) only reaches the server console log — nothing persists on the project row, so diagnosing one means log-diving for the `projectId`. Two separable pieces: (1) persist the issue to the project row (e.g. a new `validation_error jsonb` column, same pattern as `processing_attempts` — a documented `ALTER TABLE` the user runs once against Supabase) so it's visible without logs. (2) A narrow repair path for the subset of issue codes that don't require re-running the AI steps: `sumario_mismatch` and `page_number_unresolved` are downstream of Steps C/D/P (rebuilding the sumário + the LibreOffice repagination pass are both deterministic/cheap), so those could plausibly be fixed by re-running just that tail against the already-produced document rather than the whole pipeline. `malformed_xml`, `leftover_placeholder`, and `references_not_located` don't have an obvious narrow fix — the corruption/mismatch could originate in any of ~15 upstream passes, so there's nothing specific to re-run; those still need a full retry (which reproduces the bug deterministically unless AI non-determinism happens to dodge it) or a human looking at the specific document. Scope (2) deliberately — it's new pipeline entry points, not a tweak.

---

## Admin Dashboard (Analytics)

- [ ] Internal admin dashboard for the owner
  - A private, owner-only dashboard: total/active user count, sign-ups over time, revenue (total, over time, by service, trial vs paid), order count, projects by status, conversion rate, trial usage. Data sources already exist (`orders`, `projects`, `user_profiles`/Supabase auth; Stripe as a secondary reconciliation source). No concrete approach decided (in-repo admin route vs. separate app); access must be owner-only (admin role check, not just auth). To be scoped later.

---

## Pages & Legal

- [ ] Landing page redesign (unauthenticated)
  - Full visual overhaul of `LandingPage.tsx` and its sections (`Hero.tsx`, `Services.tsx`, `Pricing.tsx`) targeting non-logged-in visitors; stronger value proposition, social proof, conversion-focused layout.

---

## Infrastructure & Quality

- [ ] Error boundaries (no global React error boundary)
  - React `ErrorBoundary` class component wrapping `<Routes>` in `App.tsx`
- [ ] End-to-end tests
  - Playwright — cover auth flow, full order flow, dashboard
- [ ] Unit tests
  - Vitest — cover `pricing.ts`, `docx-slice.ts`, `laudas.ts`
- [ ] Final code refactor
  - Pass over the entire codebase before deploy: remove dead code, consolidate duplicated logic, enforce consistent naming, split any components that grew too large, ensure all strings go through `t()`, confirm no `any` types or unused vars remain.

---

## Design & Branding

- [ ] New branding and color system
  - Define new brand identity: logo, color palette, typography scale. Update `tailwind.config.js` tokens (currently `sand`, `forest`, `ink`, etc.) and propagate across all components. Update `DESIGN.md` to match.
