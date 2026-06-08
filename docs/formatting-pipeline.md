# DOCX Formatting Pipeline

How FormaTexto turns an uploaded `.docx` into an academically formatted one. This
describes the system as it works **today**, built server-side in
`server/src/lib/formatting/`. (The pipeline was originally prototyped in n8n; that
is gone. Older `formattingPlan*.md` files have been retired in favour of this doc.)

## Scope

- **DOCX only.** A `.docx` is a zip of XML parts. The pipeline edits
  `word/document.xml` and `word/styles.xml` directly as XML strings — never plain
  text — then re-zips. PDF formatting is not in the first release.
- **Heading structure cannot be trusted.** Many authors type chapter titles as
  ordinary bold/large paragraphs instead of using Word heading styles. Detecting
  and fixing that is part of the job, not an input we are given.

## The five steps

```
download original .docx → unzip → document.xml + styles.xml
  A  [no AI]  rewrite styles.xml · strip direct overrides · fix margins
  B  [no AI]  locate references (user-flagged pages) · format heading + entries
  C  [AI]     reformat each reference entry to the guideline citation format
  D  [AI]     reclassify paragraphs that are really headings → Heading1/2/3
  E  [no AI]  re-zip → upload processed/ → stamp status=complete → ready email
```

Steps A and B are deterministic and run on the whole document at once — string
manipulation has no token limit, so a 200-page file is as cheap as a 2-page one.
Only the two AI passes (C, D) can exceed a model's context window, so **chunking is
confined to C and D**; each does its own chunking before the model call and its own
merge after.

**Build status:** A, B, D, E are built and tested. **Step C is not built yet** — it
is the next pipeline feature (it mirrors Step D's design).

Orchestrator: `processFormatting.ts`. Trigger: `POST /api/processing/start`
(fire-and-forget, returns 202). Proofreading is a separate service and has not yet
moved off n8n.

## Design principles (do not break these)

1. **The AI never emits XML.** Models drop namespaces, reorder runs, corrupt
   attributes. Each AI pass returns small, zod-validated structured data;
   deterministic code applies it to the original XML by absolute block index. The
   worst case of a bad answer is a wrong heading level or an unchanged entry —
   never corrupted text or an unopenable file.
2. **The guideline `.md` spec is the single source of truth.** `specs/{id}.md`
   carries both the machine-readable values (§8, parsed by `loadGuideline.ts`) and
   the prose rules the prompts read (§4 for headings, §5–§7 for references). Edit
   the spec and the next job picks it up — no rebuild, no restart.
3. **An AI failure never fails a paid job.** If a pass errors or returns garbage,
   the pipeline keeps the deterministic A/B result and finishes. Guarded by the
   `AI_FORMATTING_ENABLED` flag plus a try/catch fallback in the orchestrator.
4. **Each pass is independently testable** via a `Decider` interface: tests inject
   a deterministic fake (no network); the real OpenRouter decider lives in `ai/`.
   A separate live eval runs only under `RUN_AI_EVALS=1`.

## Chunk-and-merge (Steps C and D)

- The atomic unit is a **top-level block of `<w:body>`** (a `<w:p>` or `<w:tbl>`),
  parsed by the shared `blocks.ts`. Every block keeps its **absolute index**; that
  index is the merge key.
- Each block is reduced to a compact descriptor (`{ i, text, style, bold, len }`).
  The model returns decisions keyed by `i`; `replaceBlocks` splices results back by
  index, touching nothing else.
- **Step D** chunks body paragraphs (excluding references), returns
  `[{ i, role: title|h1|h2|h3|body }]`, rewrites only `<w:pStyle>`. Each chunk
  carries the last 1–2 headings seen before it so a level decision survives a
  mid-document cut. `body` = leave as-is; D only promotes, never demotes.
- **Step C** (planned) chunks reference entries, returns
  `[{ i, segments: [{ text, emphasis? }] }]`; deterministic code renders segments
  into `<w:r>` runs (emphasis → `<w:b/>`/`<w:i/>`) and splices over the entry range.

## References detection

References are located by the **user-flagged pages** (`references_pages`), NOT by
scanning for the word "Referências" (which can appear in body text). DOCX has no
page metadata, so flagged page numbers are mapped to paragraphs using pagination
signals (manual page breaks, inline `<w:sectPr>`, `<w:lastRenderedPageBreak>`, then
a 40-block fallback). The whole document — references included — lives in one stored
file; `references_file_path` is deprecated. `locateReferences()` is shared by Step B
(formats), Step C (reformats entries), and Step D (excludes the references region).

## AI configuration

Gateway is **OpenRouter** via the OpenAI-compatible protocol, called through the
Vercel AI SDK (`generateObject` + zod). Model-agnostic by design — swapping models
is a config change (`AI_MODEL`), never a code change, because the `Decider`
interface is the seam. Determinism knobs (`AI_TEMPERATURE=0`, `AI_SEED`, optional
`AI_PROVIDER` pin) keep heading results stable run-to-run. All knobs live in
`ai/config.ts`; see `server/.env.example`.

## Key files

| File | Role |
|---|---|
| `processFormatting.ts` | Orchestrator: download → A → B → D → re-zip → upload → stamp |
| `applyStepA.ts` | Step A (rewriteStyles · stripOverrides · rewriteMargins · fontPolicy) |
| `references.ts` | Step B + shared `locateReferences` / `pageForBlock` |
| `stepD.ts` | Step D chunk + apply (model-agnostic) |
| `ai/headingDecider.ts` | Real Step D decider (OpenRouter) |
| `ai/config.ts` | AI knobs, all env-overridable |
| `blocks.ts` | Shared top-level block parser (indices, descriptors, splice) |
| `loadGuideline.ts` | Reads `specs/{id}.md` (machine block + prose sections) |
| `specs/abnt.md` | Canonical ABNT spec — single source of truth |
| `prompts/heading-classification.md` | Step D system-prompt body |

## Guideline coverage

ABNT is fully specified (`specs/abnt.md`). APA, MLA, and Chicago have built-in
fallback values in `guidelines.ts` but no spec file yet — adding one `{id}.md` makes
the guideline appear in the dropdown and drive the deterministic passes automatically.
