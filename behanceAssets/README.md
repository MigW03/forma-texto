# Behance Assets — scriba

This folder holds everything needed to publish a Behance case study for scriba. It was assembled by driving the real, running app end-to-end (not mockups) so every screen reflects actual product behavior.

## Contents

- **`case-study.md`** — the full narrative, ready to adapt into Behance's project editor. Written in sections you can paste one at a time as you build the page (Overview → Problem → Process → Screens → System → Results).
- **`wireframe.html`** — a standalone visual mockup of how the case study page could read as a single scroll: cover, overview, process, screen gallery, design-system specimen, results, credits. Open it directly in a browser. Real screenshots embedded inline; the Project Detail section is a labeled placeholder until that screen exists.
- **`screenshots/`** — real captures from the live app at 1440×900, taken in sequence through the actual user flow.

## Screenshot map

| File | Screen | Notes |
|---|---|---|
| `01-landing.png` | Marketing landing page | Hero, upload/link tabs, service intro |
| `02-sign-in.png` | Sign in | |
| `03-sign-up.png` | Sign up | |
| `04-terms.png` | Terms of Service | Long-form content page |
| `05-privacy.png` | Privacy Policy | Long-form content page |
| `06-dashboard.png` | Dashboard, empty state | "No documents yet" |
| `07-profile.png` | Account settings | Personal info, password, notifications, danger zone |
| `08-get-started.png` | New service, step 1 | Service cards unselected |
| `09-get-started-filled.png` | New service, step 2 | Both services selected, guideline chosen, file uploaded |
| `10-get-started-ready.png` | New service, step 3 | Terms agreed, CTA enabled |
| `11-page-selection.png` | Lauda (page) selection | Document preview, per-lauda selection, references toggle, live price summary |
| `12-checkout.png` | Checkout | Order summary, pricing breakdown, retention notice |

## What's not covered

The **Project Detail** page (`/projects/:id`) requires a fully processed, paid project — Stripe wasn't configured in this local pass, so checkout stops at the payment step. `case-study.md` describes that screen from source (`web/src/pages/ProjectDetailPage.tsx`) rather than showing a live capture. Swap in a real screenshot once a completed project exists.

## Before publishing

The profile screenshot (`07-profile.png`) shows a real email address. Blur or crop it out before making the case public.
