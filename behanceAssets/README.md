# Behance Assets — FormaTexto

This folder holds everything needed to publish a Behance case study for FormaTexto. It was assembled by driving the real, running app end-to-end (not mockups) so every screen reflects actual product behavior.

**Last refreshed:** 2026-07-25, against `main` at commit `293dd44` (landing page overhaul, saved payment methods, Google avatar). See "Refresh status" below — five screens were re-captured live; the rest were verified against source and updated in text, but still show an earlier build's pixels pending a session with real Supabase/Stripe test credentials.

## Contents

- **`case-study.md`** — the full narrative, ready to adapt into Behance's project editor. Written in sections you can paste one at a time as you build the page (Overview → Problem → Process → Screens → System → Results).
- **`wireframe.html`** — a standalone visual mockup of how the case study page could read as a single scroll: cover, overview, process, screen gallery, design-system specimen, results, credits. Open it directly in a browser. Real screenshots embedded inline; the Project Detail and saved-payment-methods sections are labeled placeholders until those screens can be captured with a real signed-in session.
- **`screenshots/`** — real captures from the live app at 1440×900+ (full page), taken in sequence through the actual user flow.

## Screenshot map

| File | Screen | Notes |
|---|---|---|
| `01-landing.png` | Marketing landing page | **Refreshed 2026-07-25.** Real per-lauda BRL pricing, "Em breve" guideline panel, mechanical-only proofreading diff, footer. |
| `02-sign-in.png` | Sign in | **Refreshed 2026-07-25.** Unchanged in substance. |
| `03-sign-up.png` | Sign up | **Refreshed 2026-07-25.** Now includes the confirm-password field with inline mismatch validation. |
| `04-terms.png` | Terms of Service | **Refreshed 2026-07-25.** |
| `05-privacy.png` | Privacy Policy | **Refreshed 2026-07-25.** |
| `06-dashboard.png` | Dashboard, empty state | "No documents yet" — stale pixels (auth-gated), copy in `case-study.md` still accurate |
| `07-profile.png` | Account settings | Stale pixels — now also has a saved-payment-methods section, not shown in this capture |
| `08-get-started.png` | New service, step 1 | Service cards unselected — stale pixels, layout unchanged |
| `09-get-started-filled.png` | New service, step 2 | Both services selected, guideline chosen, file uploaded — stale pixels, layout unchanged |
| `10-get-started-ready.png` | New service, step 3 | Terms agreed, CTA enabled — stale pixels, layout unchanged |
| `11-page-selection.png` | Lauda (page) selection | Stale pixels — pré-textual elements now render as their own labeled page cards, not shown in this capture |
| `12-checkout.png` | Checkout | Stale pixels — saved-card selection UI now shown here, not in this capture |

## Refresh status (2026-07-25)

The app's Supabase/Stripe backend needs real project credentials to sign in, so this pass could only re-capture the **five unauthenticated screens** (landing, sign-in, sign-up, terms, privacy) live against current `main`. Those are done — see the table above.

For the seven screens that require a signed-in session (dashboard, profile, get-started × 3, page-selection, checkout, project detail), the code was read directly instead: `case-study.md` and `wireframe.html`'s copy now describe the current behavior (saved payment methods, the redesigned `needs_input` panel with grouped Tabelas/Figuras and the "deixar em branco" confirm step, pré-textual page cards, saved-card checkout). The **pixels** for those seven are still from the earlier build. `wireframe.html` marks the two screens where the drift is most visible (Lauda selection, Checkout) with an inline "screenshot refresh pending" note, and a new placeholder block for the saved-payment-methods screen (no earlier capture existed at all).

**To finish this:** run the app with a real `web/.env.local` (Supabase + Stripe test keys) and `server/.env`, sign in, and re-run the same 1440-wide full-page capture for the seven screens above — then swap them into `screenshots/` and drop the "refresh pending" notes from `wireframe.html`.

## What's not covered

The **Project Detail** page (`/projects/:id`) requires a fully processed, paid project — this pass didn't have Stripe/Supabase credentials at all, so it goes further than "checkout stops at payment": no authenticated screen could be captured live this round. `case-study.md` and `wireframe.html` describe it from source (`web/src/pages/ProjectDetailPage.tsx`). Swap in a real screenshot once a completed project exists.

## Before publishing

The profile screenshot (`07-profile.png`) shows a real email address. Blur or crop it out before making the case public.
