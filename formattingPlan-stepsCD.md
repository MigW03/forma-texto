# Formatting Pipeline — Steps C & D (AI passes), Server Implementation Plan

> **Status:** planning only — **nothing here is built yet.** This is a handoff document
> for the next agent who will implement Steps C and D.
>
> **n8n is no longer used in this project.** The whole pipeline runs **server-side** in
> `server/src/lib/formatting/` (Express + TypeScript). There is no n8n anywhere in the
> current architecture. The older `formattingPlan.md` was written for an n8n build and is
> now historical; **this file supersedes its Step C/D sections** for the server build.

This plan covers the two AI passes of the DOCX formatting pipeline. Steps A, B, and E
already exist and are tested server-side; this document is only about C and D.

- **Step C — reference reformatting (AI):** rewrite each reference entry into the
  guideline's citation format (author order, punctuation, emphasis, DOI).
- **Step D — heading reclassification (AI):** find paragraphs that are really headings
  but were typed as ordinary text, and assign them the correct heading level.

---

## Guiding principles (do not break these)

1. **The AI never emits XML.** Models drop namespaces, reorder runs, and corrupt
   attributes. Every AI pass returns small, validated, structured data; deterministic
   code applies it to the original XML. The worst case of a bad answer is a wrong
   heading level or an unchanged entry — never corrupted text or an unopenable file.
2. **The guideline `.md` files are the single source of truth.** Prompts pull their
   rules and examples from the spec files (`specs/{id}.md`), not from hardcoded strings.
   One place to edit a rule; both the deterministic code and the AI prompts follow it.
3. **An AI failure never fails a paid job.** If a pass errors, times out, or returns
   garbage, the pipeline keeps the deterministic result from Steps A/B and finishes.
   The customer still gets a correctly laid-out document.
4. **Each pass is independently testable** with a fake AI, so unit tests never call the
   network. Live model behaviour is checked separately behind a flag.

---

## Infrastructure to set up BEFORE writing any feature code

Build these foundations first. C and D both depend on most of them, so doing them up
front avoids reworking the passes later.

### 1. AI provider, key, and SDK
- Use **Anthropic Claude** (consistent with the rest of the stack's direction). Install
  `@anthropic-ai/sdk` in `server/`.
- Add `ANTHROPIC_API_KEY` to `server/.env` and document it in `server/.env.example`.
- **Model:** start with **Claude Haiku** (cheap, fast — both passes are simple,
  high-volume classification/reformatting). Keep the model id in config so it can be
  raised to Sonnet for hard documents without touching pass code.
- **Structured output:** force a JSON schema with **tool use** (the model must call a
  tool whose input schema is our decision shape). This removes "model wrote prose around
  the JSON" parsing failures. Validate the tool input with **zod** anyway.
- **Prompt caching:** the guideline rules go in the cached system prompt (they repeat
  across every chunk of a document). Only the chunk data changes per call.

### 2. Config module — `server/src/lib/formatting/ai/config.ts`
A single place for the knobs, all env-overridable:
- `model`, `maxTokens`
- `maxCharsPerChunk` (chunk budget — keep well under the context window)
- `concurrency` (parallel chunk calls; respects rate limits)
- `maxRetries` + backoff
- `enabled` feature flag — lets us ship the deterministic pipeline and turn C/D on
  separately, and disable them instantly if the model misbehaves in production.

### 3. Shared block parser — `server/src/lib/formatting/blocks.ts`
Both passes need the same notion of "top-level body blocks with stable indices."
This logic already exists privately inside `references.ts` (`getBlocks`, `isParagraph`,
`blockText`, `setParagraphStyle`). **Extract and harden it into a shared module** so
Step B, C, and D all use one parser. Public contract:
- `getBlocks(documentXml) -> string[]` — top-level `<w:p>` / `<w:tbl>` / `<w:sdt>`, in order.
- `blockDescriptor(block, i) -> { i, text, style, bold, len }` — the compact shape the
  AI sees (truncated text, never the whole body).
- `setParagraphStyle(block, styleId)` / `clearHeadingStyle(block)` — apply heading
  decisions by rewriting only `<w:pStyle>`.
- `replaceBlocks(documentXml, byIndex)` — splice rewritten blocks back by absolute index.
- **Note:** the current regex parser is good enough for Step B and fine to start with.
  If tables-with-nested-paragraphs cause index drift in real documents, swap the
  internals for `fast-xml-parser` behind this same contract — the passes won't change.

### 4. Reference-region detection, shared — refactor `references.ts`
Step B already locates the references region (heading index + entry indices) from the
user-flagged pages. **Export that as `locateReferences(documentXml, guideline, pages)
-> { headingIdx, entryIndices }`.** Step C reformats exactly `entryIndices`; Step D uses
`headingIdx` as `refStartIndex` to **exclude** references from heading classification.
One detector, three consumers — no second guess at where the references are.

### 5. Prompt-context loader from the spec files — extend `loadGuideline.ts`
Keep the single source of truth. Add helpers that read the **prose** sections of
`specs/{id}.md` (not just the §8 machine block) and hand them to the prompts:
- `loadGuidelineDoc(id) -> string` (raw markdown, mtime-cached like the spec loader).
- `guidelineSection(md, n) -> string` — slice one numbered section (e.g. `## 4.`).
- Step D prompt context = §4 (headings). Step C prompt context = §5–§7 (citations,
  references rules, and the worked examples in §7). The spec's §0 already declares these
  sections are written for the AI passes — we are wiring up what it promises.

### 6. The `Decider` seam (dependency injection for testing)
Define interfaces so passes don't hardcode the SDK:
```ts
interface HeadingDecider {  // Step D
  classify(chunk: HeadingChunk): Promise<HeadingDecision[]>   // [{ i, role }]
}
interface ReferenceDecider { // Step C
  reformat(chunk: ReferenceChunk): Promise<ReferenceResult[]> // [{ i, segments }]
}
```
- Real implementations live in `ai/` and call Claude.
- Fake implementations (deterministic, no network) live in tests.
- `stepC` / `stepD` accept the decider as a parameter (default = real). Unit tests inject
  the fake. This is what makes the passes testable in CI.

### 7. Test harness
- A golden input fixture: `server/src/lib/formatting/__fixtures__/headings-and-refs.docx`
  with known violations (titles typed as Normal; entries in mixed citation formats).
- Unit tests per pass using the **fake** decider → assert exact XML edits by index.
- A separate **live eval** test, gated by `RUN_AI_EVALS=1`, that calls the real model on
  the fixture and checks the prompts actually produce good decisions. Never runs in CI by
  default (no key, no spend, no flakiness).

### 8. Orchestrator wiring + graceful fallback
- Insert C then D between Step B and the re-zip in `processFormatting.ts`, both guarded by
  `config.enabled` and each wrapped so a thrown error logs, keeps the pre-pass XML, and
  continues. The job still reaches `status='complete'`.

### 9. (Optional) observability columns on `projects`
- `processing_stage text` (`styles | references | reformat | headings | repack`) and
  `error_message text` make a stalled long job debuggable. Defer if you want C/D landed
  first; they don't block the feature.

---

## How a document moves through the pipeline (AI marked)

```
PAID PROJECT  (status = pending)
      │
      ▼
processFormatting(projectId)
      │   download original .docx  →  unzip  →  document.xml + styles.xml
      ▼
Step A   [no AI]   rewrite styles.xml · strip direct overrides · fix margins
      ▼
Step B   [no AI]   locateReferences(flagged pages) → { headingIdx, entryIndices }
      │            format references heading + entry layout (spacing, indent, align)
      ▼
Step C   reference entries (entryIndices)
  ┌── chunk entries (never split an entry)
  │      ▼
  │   ╔═══════════════════════════════════════════════╗
  │   ║  [AI]  reformat each entry to citation format  ║   ← guideline rules from
  │   ║  returns { i, segments:[{text, emphasis?}] }   ║      specs/{id}.md §5–§7
  │   ╚═══════════════════════════════════════════════╝
  │      ▼
  └── [no AI] render segments → <w:p> runs (<w:b>/<w:i>) → splice over entry range
      ▼
Step D   body paragraphs, EXCLUDING references (index < headingIdx)
  ┌── chunk paragraphs (+ short context line: last 1–2 headings seen)
  │      ▼
  │   ╔═══════════════════════════════════════════════╗
  │   ║  [AI]  classify each paragraph's role          ║   ← heading rules from
  │   ║  returns [{ i, role: title|h1|h2|h3|body }]    ║      specs/{id}.md §4
  │   ╚═══════════════════════════════════════════════╝
  │      ▼
  └── [no AI] apply decisions by absolute index → rewrite <w:pStyle> only
      ▼
Step E   [no AI]   re-zip → upload processed/ → stamp status='complete' → ready email
```

Two AI touch points, both boxed above. Everything else is deterministic string work on
the full XML.

---

## Step C — reference reformatting (detail)

- **Input:** the entry blocks (`entryIndices` from `locateReferences`), as plain text,
  one per chunk-batch. Heading block is left to Step B.
- **AI contract (no XML):** for each entry the model returns
  `{ i, segments: [{ text, emphasis?: 'bold' | 'italic' }] }`. Ordered segments are the
  reformatted citation; emphasis marks the work title (bold in ABNT) or italic terms.
  If an entry is too ambiguous to reformat confidently, the model returns it unchanged
  (single plain segment) rather than guessing.
- **Deterministic render:** code turns segments into `<w:r>` runs (emphasis → `<w:rPr>`
  `<w:b/>`/`<w:i/>`), wraps them in one `<w:p>` carrying the Step B entry layout, and
  **splices** the rebuilt entries over the original entry range in one shot.
- **Prompt context:** §6 rules + §7 worked examples for the active guideline, pulled from
  the spec file. The examples are already written as templates per source type
  (book, chapter, article, website, thesis, DOI).
- **Merge:** contiguous splice over `[entryIndices.first .. entryIndices.last]`; chunks
  reassembled in `chunkIndex` order.

## Step D — heading reclassification (detail)

- **Candidates:** non-empty body paragraphs with `index < headingIdx` (exclude
  references). Each reduced to `blockDescriptor` — `{ i, text(≤200 chars), style, bold, len }`.
- **AI contract (decisions only):** `[{ i, role: 'title'|'h1'|'h2'|'h3'|'body' }]`. The
  model must echo every `i` it was given so the merge map is complete; default to `body`
  (leave as-is) when unsure. Cues live in §4: short line, all-caps, numbered prefix
  (`1`, `1.1`, `Capítulo 1`).
- **Cross-chunk context:** each chunk is prefixed with a read-only line naming the last
  one or two headings before it, so a level decision survives a mid-document cut.
- **Apply:** `role → styleId` (`title→Title`, `h1→Heading1`, …, `body→clear`). Rewrite
  only `<w:pStyle>` by absolute index via the shared block helpers. Title detection stays
  conservative (§4 note: front matter makes positional title-guessing unsafe).

---

## Build & test order (each feature landed and tested on its own)

1. **Infra 1–3:** SDK + key + config + shared `blocks.ts` (with unit tests on the parser,
   no AI yet).
2. **Infra 4–5:** export `locateReferences`; add the prompt-context loaders. Unit-test
   both against `abnt.md`.
3. **Step D first** (simpler contract — pure decisions). Build chunker + apply with the
   **fake** decider; unit-test the index math and `pStyle` rewrites end to end on the
   fixture. *No network.*
4. **Draft the Step D prompt**, then add the real Haiku decider. Validate with the gated
   live eval on the fixture.
5. **Step C** (richer — segments + render). Build the render-and-splice with the fake
   decider; unit-test the run/emphasis XML. Then draft the prompt and add the real decider
   + live eval.
6. **Wire both into `processFormatting`** behind the feature flag, with the fallback
   wrapper. End-to-end test through the UI on the fixture, per guideline.

Prompts are drafted in steps 4 and 5, each as its own file under `server/src/lib/formatting/ai/`
(e.g. `headingsPrompt.ts`, `referencesPrompt.ts`), assembled from the spec-file sections
so the guideline remains the single source of truth.

---

## Decisions to confirm before we start coding

- **Model:** Claude Haiku to start, config-swappable to Sonnet? (recommended)
- **Structured output:** tool-use schema + zod validation? (recommended over free-text JSON)
- **Block parser:** start on the existing hardened regex, move to `fast-xml-parser` only
  if real documents drift? (recommended — avoids premature complexity)
- **Fallback policy:** on AI failure, keep the deterministic A/B result and finish (vs.
  retry then fail)? (recommended: finish — never block a paid job)
- **Observability columns:** add `processing_stage` / `error_message` now, or defer until
  after C/D land?
