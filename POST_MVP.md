# scriba — Post-MVP Backlog

> Features and refinements deliberately deferred until **after** the first launch — not because they're
> unimportant, but because they're not required to ship a trustworthy first version. `PLAN.md` tracks what's
> still open *before* launch; `HANDOFF.md`'s "Open work" section tracks the launch-critical checklist. This
> file exists so post-launch ideas don't get lost, and don't compete for attention with what needs doing
> right now. Same discipline as `PLAN.md`: open items only — delete an item's bullet entirely once it's
> built or picked up, don't mark it `[x]` and leave a changelog. Move an item back into `PLAN.md` when it's
> actually being worked.

---

## Web / Checkout

- [ ] `ProjectDetailPage.tsx`'s `handleRecoverUpload` silently no-ops if `session` is stale/missing —
  no error shown, the re-upload just appears to do nothing. Surfaced 2026-07-24 when a real recovery
  retry looked "stuck" for several minutes; a hard refresh (which re-fetches a fresh session) fixed it.
  Fix: show an explicit error (e.g. "sessão expirada — atualize a página") instead of the silent no-op.
- [ ] Hero pre-auth handoff (`HERO_HANDOFF_KEY`/`HERO_UPLOAD_KEY` in `file-store.ts`) isn't scoped to
  the session that created it. Flagged by security review 2026-07-24: if a visitor drops a file/link on
  the landing-page Hero card, gets redirected to `/sign-in`, and abandons the flow there without signing
  in, the file/link stays in sessionStorage/IndexedDB indefinitely — `signOut()` never clears it, and
  `AuthPage`/`HomeRoute` check only whether the handoff key *exists*, not who wrote it. On a shared
  computer (plausible for this product's audience — university/library labs), whoever next signs into
  *any* account in that same browser tab gets auto-routed to `/get-started` with the abandoned file
  restored, giving them a content preview of a stranger's document. Fix: clear both keys on
  `ProtectedRoute`'s redirect-away / on `signOut()`, add a short TTL and reject stale entries, and/or
  stamp the handoff with a per-drop token so an unrelated auth completion can't consume it.

---

## Backend / AI Pipeline

- [ ] Table formatting refinement (ABNT)
  - Caption/source treatment for tables already exists and mirrors images (`captions.ts`, `missingInputs.ts` — `table_caption`/`table_source` are first-class kinds with the same placeholder/needs_input flow). What's missing is the table's own visual formatting and the tabela/quadro distinction, researched 2026-07-22:
    - **Tabela** (quantitative data, IBGE norms): open left/right borders — only 3 horizontal rules (top, below header, bottom). No vertical rules anywhere, including between columns.
    - **Quadro** (qualitative/textual data, ABNT "ilustração" rules): fully closed borders on all sides, including laterals. Currently `TABLE_LABEL_WORDS = 'tabela|quadro'` in `captions.ts` treats both identically for caption detection, which is fine for finding them but wrong for border styling.
    - **Separate numbering**: `Tabela 1, 2, 3…` and `Quadro 1, 2, 3…` must count independently. `missingInputs.ts` currently shares one `tableOrdinal` counter for both, and `CAPTION_LABEL['table_caption']` is hardcoded to the word `'Tabela'` — an unlabeled `<w:tbl>` always gets a "Tabela" placeholder, never "Quadro".
    - Deferred: the distinction is subtle enough that even authors often blur it, and the current shared treatment doesn't ship anything incorrect-looking for the common case — just not border-perfect.
- [ ] Lista de tabelas / lista de ilustrações — auto-populate when the heading already exists
  - Reuses the sumário page-resolution mechanism almost verbatim: `assignEntryPages`/`findSumarioEntries`/`setEntryPageNumber` (`sumarioPagination.ts`) work on plain text-to-rendered-PDF matching, not anything heading-specific. New work is a `buildListaTabelas`/`buildListaIlustracoes` mirroring `buildSumario` (`sumario.ts`) but walking table/figure caption paragraphs (`isTableBlock`/`isImageParagraph` + `TABLE_LABEL_RE`/`FIGURE_LABEL_RE` from `captions.ts`) instead of `headingLevel` matches, extracting caption text minus the "Figura N — " / "Tabela N — " prefix, and wiring a second pagination pass into `processFormatting.ts` before the existing `paginateSumario` call.
  - **Gated on the section heading already existing** in the source doc — `preTextual.ts` already detects `listaIlustracoes`/`listaTabelas` deterministically (labeled-section Bucket 1 in `business_decisions/pretextual-elements.html`). When absent, no-op — same as today, no regression risk for documents without the section.
  - Deliberately does NOT insert a missing section into a document that lacks one — see the modal item below for that.
  - Reasoning for deferring: it's an optional ABNT element, purely additive polish (doesn't fix anything currently broken), and touches the same sumário/pré-textual pagination machinery that has repeatedly needed real-document fixes — safer to add once the app has production mileage.
- [ ] Missing pré-textual elements modal — let the user proactively add a labeled section the pipeline detected as absent
  - Depends on the lista de tabelas/ilustrações item above shipping first — its populate step (insert the heading, then call the same builder) is the reusable foundation; the modal's job is only detection-surfacing + user opt-in + the insert step.
  - Detection is already free: `preTextual.ts` either finds each labeled section or it doesn't — "missing" is just the negative case of an existing pass, no new detection logic needed.
  - Scope as a general "add a missing labeled section" capability, not narrowly for tables — the same idea applies to lista de abreviaturas, agradecimentos, errata, etc. Design deliberately once real-document testing shows how often sections are actually missing (informs whether this is worth prioritizing at all).
