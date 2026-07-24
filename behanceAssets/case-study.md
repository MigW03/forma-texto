# FormaTexto — Case Study Content

Written to be pasted into Behance's project editor, section by section. Screenshot references point to files in `screenshots/`.

This version leads with problem, users, and reasoning — not framework choices. A recruiter reading a UX portfolio wants to see *how you think*, not what you built with. Technical detail is pushed to a single line at the end.

---

## Cover / one-liner

**FormaTexto — why does formatting a thesis cost a week and an opaque quote?**

A case study in designing for trust: getting a student to hand their thesis to an AI, and to a price they can't see coming, in a market where the only alternative is a slow human and a vague invoice.

Suggested cover image: `01-landing.png`, cropped to the hero.

---

## The problem

This started from direct experience, not a research study: formatting a thesis to a specific academic standard — ABNT NBR 14724, for most Brazilian universities — is mechanical, rule-heavy work that has nothing to do with the actual writing. Margins, heading hierarchy, reference formatting, figure and table captions, all against a style guide most students read for the first time under deadline pressure.

The existing alternative is a cottage industry of human formatting services. I knew this market directly: they quote per job, not per page, so a student has no idea what they'll pay until someone else has already looked at the file. Turnaround is one to two weeks. There's no way to ask for "just the references chapter" — it's the whole document or nothing. And because it's a person doing the work by hand, the price scales with the reviewer's time, not with how much of the document actually needs attention.

So the problem wasn't "formatting is annoying." It was: **the only fast, cheap way to solve this is a black box you have to trust blind — an unknown price, an unknown turnaround, and a stranger rewriting a document you're about to defend in front of a committee.** Any AI-based alternative inherits that trust problem and adds a new one: will it change *my* voice, or introduce an error I won't catch before the banca?

---

## Who this is for, and what they actually need

No formal interviews here — the reasoning comes from having been this user, and from directly observing how the existing market fails them. I'm naming that plainly rather than dressing it up as research that didn't happen.

The person this is for is a student close to a deadline (a defense date, a submission window), self-funding or budget-conscious, who has already written the thing and now has to make it *look* right. Working backward from that situation, a few needs came up again and again:

- **"I need to know the cost before I commit, not after someone reviews my file."** Price anxiety is real when you're a student paying out of pocket — an opaque quote is a reason to not even start.
- **"I don't want the whole document touched if I only need help with one part."** If a service only offers all-or-nothing, it's charging you for work you didn't ask for.
- **"I need to trust that an AI won't quietly rewrite my voice in a document I have to defend out loud."** This is an academic document under scrutiny, not a blog post — overconfident automatic rewrites are a liability, not a feature.
- **"My school has one specific standard, and 'formatted nicely' isn't the same as 'ABNT NBR 14724 compliant.'"** Generic formatting is not the deliverable; compliance with a named standard is.
- **"I'm on a deadline — I can't afford a back-and-forth, but I also don't want to pay before I know this actually works."** Speed matters, but so does a way to de-risk the first try.
- **"If the tool gets stuck on something, I don't want to lose my place and start over."** A rigid pipeline that fails hard on the first edge case is worse than a slow human who'd just ask a question.
- **"This is my unpublished thesis. I want to know it isn't sitting on someone's server indefinitely."** Privacy isn't an afterthought when the document is your own unpublished academic work.

---

## Design principles

Four principles fell out of that needs list and shaped every screen that followed:

1. **The price on screen one is the price at checkout.** No quote, no review period, no gap between what a user sees and what they pay.
2. **Granularity, not all-or-nothing.** The unit of work (and of price) is a "lauda" — roughly 300 words, the standard Brazilian academic page unit — not "the document." Users choose exactly what gets processed.
3. **Show the work, don't just hand back a file.** Every step that touches the document renders it — the actual pages, not an icon or a filename — so nothing is a black box the user has to trust blindly.
4. **Fail soft, not hard.** When the pipeline hits something it can't resolve on its own, it flags it and keeps going rather than blocking the whole document.

---

## Needs → decisions

The part of this process worth showing a hiring manager isn't the screens themselves — it's the line from a specific user need to a specific, sometimes non-obvious, design decision.

| User need | Design decision | Why this, and not the obvious alternative |
|---|---|---|
| Know the cost upfront | Per-lauda pricing with a running total visible from the first screen through checkout | The obvious pattern in this market is "submit for a quote." Rejected it outright — a visible price is the entire point of not being a human service. |
| Don't pay for scope I didn't ask for | Lauda-by-lauda selection, not whole-document-only | Considered defaulting to "process everything" for simplicity. Rejected it — it silently overcharges anyone who only needs part of a document fixed, which is common for a thesis (methodology already reviewed by an advisor, only the references need work). |
| Trust the AI with my academic voice | Proofreading copy states explicitly what it won't do ("no overconfident rewrites, no voice changes you didn't ask for") + the page-selection screen renders the real document, not a summary | A generic "AI-powered editing" pitch reads as a risk to an academic user, not a benefit. Naming the restraint directly, and showing the actual text rather than an abstraction, does more for trust than a longer feature list would. |
| Match a *named* standard, not vague "nice formatting" | An explicit guideline picker (ABNT NBR 14724, APA, MLA, Chicago) surfaced as soon as formatting is selected | Could have shipped one default style. Didn't — "close enough" formatting doesn't pass an academic committee, so the standard itself needed to be a first-class, visible choice, not a setting buried in preferences. |
| De-risk trying an unfamiliar service before paying | One free lauda, no card required, stated directly on the primary CTA | Free trials are usually hidden behind signup friction or fine print. Put it on the button itself, because the biggest drop-off risk here isn't price — it's "will this actually work on my document," and that has to be answerable before any payment screen. |
| Don't lose my progress if something's ambiguous | A `needs_input` state: the pipeline inserts a placeholder for a caption or source it can't infer and flags only that gap, instead of blocking the whole document or guessing silently | The two easy defaults — silently guess, or refuse the whole file — both fail the user. Guessing risks a wrong citation in a defended thesis; refusing wastes the time already spent. A scoped, visible gap the user can fill in five seconds does neither. |
| Know my document won't sit on a server forever | A file-retention notice stated at upload *and* restated at checkout, not left to the Terms of Service | Legal coverage alone (a ToS clause) doesn't address the anxiety in the moment someone's about to upload an unpublished thesis. Restating it at the two points of highest hesitation does. |

---

## Walking the flow

### Landing
`01-landing.png`
Leads with the upload zone itself, not a hero image — you can start the real task (drop a file or paste a Google Docs link) before creating an account. This exists because the trust problem starts immediately: if the first thing a visitor sees is a sign-up wall, they've already left to go compare against the human service they know.

### New service — services, guideline, upload
`09-get-started-filled.png`
One scrolling page instead of a multi-step wizard, because splitting "pick a service" and "pick a standard" and "upload a file" into separate pages would have hidden the total price behind extra clicks — working against the first design principle. The submit button stays disabled until every required input (service, file, agreed terms) is satisfied; that's deliberate friction against submitting an incomplete order by accident, not an oversight.

### Lauda selection
`11-page-selection.png`
The screen that does the most work against the trust problem. The left rail lists every lauda for one-click include/exclude — the "granularity, not all-or-nothing" principle made concrete. The center pane renders the actual document, so a user is looking at *their* pages, not a generic preview. The right rail keeps the price summary live as selections change, so the number never lags behind the decision that produced it.

### Checkout
`12-checkout.png`
Deliberately boring: a line-item summary that matches the previous screen exactly, a restated retention notice, then payment. If this screen introduced any new information the user hadn't already seen, it would break the first design principle.

### Project detail — original vs. processed
Not pictured yet (see `README.md`) — this is where "show the work" matters most. The finished project renders original and processed documents side by side rather than only offering a download, so the user can verify the result before trusting it, and any `needs_input` gaps surface as a short, specific list rather than a vague "action required" flag.

---

## What's unvalidated

Worth saying plainly, because pretending otherwise would undercut the rest of this: none of the above has been tested with real users yet. The needs list is reasoned from firsthand experience and close knowledge of the existing market, not from interviews or usability sessions. The honest next step is exactly that — put the get-started → lauda-selection flow in front of five actual thesis-writing students and see where the "granularity, not all-or-nothing" idea holds up against what people actually predict about their own document (do they *know* which laudas need work before seeing them rendered, or does the screen itself teach them that). That's the test that would tell me whether principle #3 is doing what I think it's doing.

---

## Craft notes

Built on a small, consistent design system (sand/ink/forest palette, Inter for UI, Georgia reserved for emphasis) applied identically from the marketing page to account settings, on React 19 / TypeScript / Tailwind / shadcn/ui, with Supabase, Stripe, and a multi-model AI pipeline behind it.

---

## Credits

Product design & frontend: [your name]
