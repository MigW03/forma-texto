# FormaTexto — Feature Plan

> Open items only. Completed work is not tracked here — see [`HANDOFF.md`](HANDOFF.md) for current
> state and `git log` for history. Mark an item `[x]` and move it out on completion; add new items in
> their own deliberate edit.

---

## Auth

- [ ] Delete account
  - Supabase admin API or Edge Function — requires server-side call

---

## Onboarding Flow

- [ ] **HIGH PRIORITY — ABNT page-number display convention** (2026-07-15, user-reported, not yet
      investigated or implemented). Per NBR 14724, the folha de rosto onward counts toward the total
      page count, but the printed page number should stay hidden through the entire pré-textual region
      — only becoming visible starting on the first page of the textual part (Introdução), at the
      correct cumulative number (not restarted at 1). Today `suppressCoverPageNumber` only hides the
      number on the capa's own physical first page (`<w:titlePg/>`); every other pré-textual page still
      shows one, and nothing starts the visible numbering at `bodyStart`. See `HANDOFF.md`'s Open work
      section for the full write-up and why this needs its own section-break-based design.

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

- [ ] PDF formatting function
  - Read uploaded PDF, apply academic formatting rules (margins, fonts, heading hierarchy, spacing) per selected guideline, write formatted PDF back to Storage. (DOCX input is the only format the formatting pipeline handles today.)
- [ ] PDF correction — apply corrected text to existing PDF
  - After a proofreading pass produces corrected text, edit the original PDF in-place; preserve layout, fonts, and structure as much as possible.

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
