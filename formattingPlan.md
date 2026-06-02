# DOCX Formatting — Implementation & Test Plan

## Scope — first release

- **DOCX only.** No PDF support in the first release. Every input is a `.docx` (a zip of XML parts).
- **Text extraction happens inside n8n**, not on the client. The unzip step reads `word/document.xml` and `word/styles.xml` as raw XML strings, and the whole pipeline works directly on this WordprocessingML XML — never on plain text.
- **Heading structure cannot be trusted.** Many users never apply Word's heading styles: chapter titles are typed as ordinary paragraphs made bold or large by hand. Detecting and correcting that structure is part of the formatting job, not an input we are given.

## Architecture

Formatting is split into deterministic XML passes (no AI) and two targeted AI passes. AI only touches the parts that need semantic understanding, which keeps cost and risk low.

```
DOCX formatting pipeline
├── Step A (no AI):     rewrite styles.xml + strip direct overrides + fix margins
├── Step B (no AI):     detect references section + apply hanging indent + spacing
├── Step C (AI, chunked): reformat reference entries to guideline citation format
├── Step D (AI, chunked): reclassify headings in document.xml
└── Step E (no AI):     repack → upload → stamp DB
```

Steps A and B are deterministic and run on the **whole** `document.xml` string at once. String manipulation has no token limit — a 200-page file is as easy as a 2-page one. Only the two AI passes can exceed a model's context window on a long document, so **splitting is needed only for Steps C and D, nowhere else.** See the next section.

Proofreading runs as a separate branch (same repack/upload/stamp step at the end). When both services are selected, formatting and proofreading run sequentially on the same file — formatting first, then proofreading on the formatted output.

---

## Splitting & merge strategy

This is the part that makes 50+ page documents work.

### What gets split, and where

The deterministic passes never split — string manipulation on the full XML is fast and lossless. Splitting is confined to the two AI passes, and each pass does its own chunking right before its AI node and its own merge right after. They do not share chunks.

- **Step D (headings):** chunk all body paragraphs, excluding the references section.
- **Step C (references):** chunk the reference entries only.

### Unit of split

The atomic unit is a **top-level block of `<w:body>`** — a `<w:p>` paragraph or a `<w:tbl>` table. A block is never split across chunks; that would produce invalid XML. Every block keeps its **absolute index** (its position in the body, `0..N`). That index is the key that makes merge trivial.

### The AI returns decisions, never XML

Critical design choice: we do **not** ask the model to emit corrected XML. Models mangle namespaces, drop attributes, and reorder runs. Instead:

- Each block is reduced to a compact descriptor — `{ i, text (truncated), style, bold, length }` — and the model returns only **decisions**: `[{ i, role: "title" | "h1" | "h2" | "h3" | "body" }]`.
- A deterministic Code node then applies those decisions to the **original** XML by index: it rewrites only `<w:pStyle w:val="…"/>` on the named blocks and touches nothing else.

The content is therefore never at the mercy of the model. The worst case of a bad decision is a wrong heading level — not corrupted text.

### How merge works

Because every decision carries the absolute block index, merge is a keyed map application, not a reassembly:

1. Collect decisions from every chunk into one list (arrival order does not matter).
2. Build `Map<index, role>`.
3. Re-parse the original body into the same indexed block array.
4. For each block: if the map has its index, rewrite its `pStyle`; otherwise leave it untouched.
5. Re-serialize the body back into `document.xml`.

The **references merge** is a contiguous splice instead: the references occupy a known index range `[refStart..end]`; reformatted entries come back per chunk, are concatenated in `chunkIndex` order, and replace that range in one shot.

### Token budget & cross-chunk context

- The budget per chunk is set well under the model's input limit. The compact descriptor (truncated text + a few flags) keeps a chunk small, so one chunk can still cover many pages of real document.
- Heading levels are partly relative ("1.1" sits under "1"). To survive a mid-document cut, each chunk is prefixed with a short read-only context line listing the last one or two headings seen before it. Numbered headings ("1.", "1.1", "Capítulo 3") are largely self-describing, which limits cross-chunk dependence.

### Chunker (Step D) — n8n Code node, "Run Once for All Items"

```js
// STEP D — CHUNK paragraphs for the heading-reclassification AI pass.
// Input json: { documentXml, guideline, refStartIndex }   (refStartIndex = -1 if no references)

const { documentXml, guideline, refStartIndex = -1 } = $input.first().json;

// parseTopLevelBlocks → [{ index, xml, text, style, bold }] in body order.
// Implement with fast-xml-parser (see parsing note below). Contract used here:
const blocks = parseTopLevelBlocks(documentXml);

// keep only real body paragraphs before the references section
const candidates = blocks.filter(b =>
  b.text.trim().length > 0 &&
  (refStartIndex < 0 || b.index < refStartIndex)
);

const MAX_CHARS = 8000; // compact-text budget per chunk — tune to the model
const descriptor = b => ({
  i: b.index,
  text: b.text.slice(0, 200), // heading detection needs the start, not the whole body
  style: b.style || 'Normal',
  bold: !!b.bold,
  len: b.text.length,
});

const chunks = [];
let cur = [], size = 0, seenHeadings = [];
for (const b of candidates) {
  const d = descriptor(b);
  const cost = d.text.length + 40;
  if (size + cost > MAX_CHARS && cur.length) {
    chunks.push({ blocks: cur, context: seenHeadings.slice(-2) });
    cur = []; size = 0;
  }
  cur.push(d); size += cost;
  if (/heading/i.test(d.style) || (d.bold && d.len < 80)) seenHeadings.push(d.text);
}
if (cur.length) chunks.push({ blocks: cur, context: seenHeadings.slice(-2) });

return chunks.map((c, k) => ({
  json: { guideline, chunkIndex: k, totalChunks: chunks.length, context: c.context, blocks: c.blocks },
}));
```

### Apply + merge (Step D) — n8n Code node, "Run Once for All Items"

```js
// STEP D — APPLY heading decisions back into the original document.xml.
// Each incoming item json: { decisions: [{ i, role }] }
// Original XML pulled from the unzip node by name.

const decisions   = $input.all().flatMap(it => it.json.decisions || []);
const roleByIndex = new Map(decisions.map(d => [d.i, d.role]));

const STYLE = { title: 'Title', h1: 'Heading1', h2: 'Heading2', h3: 'Heading3', body: null };

const documentXml = $('Unzip DOCX').first().json.documentXml;
const blocks = parseTopLevelBlocks(documentXml); // same parser as the chunker

const rebuilt = blocks.map(b => {
  if (!roleByIndex.has(b.index)) return b.xml;      // untouched
  const style = STYLE[roleByIndex.get(b.index)];
  return style ? setParagraphStyle(b.xml, style)    // rewrite <w:pStyle w:val="..."/>
               : clearHeadingStyle(b.xml);           // demote to body
});

const newDocumentXml = replaceBodyChildren(documentXml, rebuilt);
return [{ json: { documentXml: newDocumentXml } }];
```

> **Parsing note.** Regex over WordprocessingML is fragile — tables nest paragraphs, and `<w:p` also matches `<w:pPr>`/`<w:pStyle>`. Both nodes above assume helpers `parseTopLevelBlocks`, `setParagraphStyle`, `clearHeadingStyle`, `replaceBodyChildren`. Implement them with `fast-xml-parser` (feasible since the unzip step already uses `fflate` as an external module — add `fast-xml-parser` to `NODE_FUNCTION_ALLOW_EXTERNAL`). Do not hand-roll regex block splitting for production.

---

## Resources required

### Database (Supabase Postgres)
- The `projects` table already carries what the pipeline needs: `status`, `guideline`, `services`, `original_file_path`, `processed_file_path`, `references_pages`, `references_file_path`, `completed_at`.
- **Status values:** standardize on the app enum `pending → processing → ready → delivered`. (An earlier draft of this plan said `status = ready`; that is wrong — use `ready`.) Stamp `processing` when n8n starts and `ready` when the processed file is written.
- **Recommended additions for long-job observability:** `processing_started_at timestamptz`, `error_message text`, and optionally `processing_stage text` (`styles | headings | references | repack`) so a stalled 50-page job is debuggable.

### Supabase Storage
- Bucket `projects`. Input lives at `{userId}/{filename}`. Write the processed output to a distinct key — recommend `{userId}/{projectId}/processed/{filename}` — and stamp it into `processed_file_path`. n8n needs the **service-role key** to read input and write output.

### Backend (Express server)
- Needs to **trigger n8n** once a project is paid and ready. Today `server/src/routes/webhook.ts` only inserts the order on `payment_intent.succeeded`. Add: once the project row exists with `status = pending`, POST `{ projectId }` to the n8n webhook (new route such as `POST /api/processing/start`, or fire it directly from the Stripe webhook handler).
- Reuse the existing service-role Supabase client at `server/src/lib/supabase.ts`.
- Decide trigger ownership (see open questions): backend push vs. n8n polling vs. Supabase DB webhook on insert.

### n8n
- **Trigger:** Webhook node receiving `{ projectId }`.
- **Credentials:** Supabase service-role (Storage + REST) and an AI model API key (Claude Haiku / GPT-4o-mini for Steps C and D).
- **External modules:** enable `fflate` and `fast-xml-parser` via `NODE_FUNCTION_ALLOW_EXTERNAL`.
- **Execution timeout:** raise it — a 50-page job with two chunked AI loops runs for minutes. Respond `202 accepted` immediately and update DB status asynchronously rather than holding the HTTP connection open.
- A **Loop Over Items** node throttles per-chunk AI calls to respect rate limits; a **sub-workflow** per AI pass keeps the main flow readable.

---

## Guideline Specs

### Body & layout — applied in Step A

| Property | ABNT | APA 7th | MLA 9th | Chicago 17th |
|---|---|---|---|---|
| Font | Times New Roman | Times New Roman | Times New Roman | Times New Roman |
| Body size | 12pt | 12pt | 12pt | 12pt |
| Line spacing | 1.5 | Double (2.0) | Double (2.0) | Double (2.0) |
| Paragraph indent | 1.25cm first line | 0.5in first line | 0.5in first line | 0.5in first line |
| Body alignment | Justified (`both`) | Left (ragged right) | Left (ragged right) | Left (ragged right) |
| Margin top | 3cm | 1in | 1in | 1in |
| Margin bottom | 2cm | 1in | 1in | 1in |
| Margin left | 3cm | 1in | 1in | 1in |
| Margin right | 2cm | 1in | 1in | 1in |
| Heading font | Arial 12pt bold | Times New Roman 12pt bold | Times New Roman 12pt | Times New Roman 12pt |

### References section — applied in Steps B & C

| Property | ABNT | APA 7th | MLA 9th | Chicago 17th |
|---|---|---|---|---|
| Section heading text | REFERÊNCIAS | References | Works Cited | Bibliography |
| Heading style | All caps, left-aligned | Bold, centered | Not bold, centered | Not bold, centered |
| Entry spacing | Single within entry, 6pt between | Double throughout | Double throughout | Single within, blank line between |
| Hanging indent | 0cm left, no hang (left-flush) | 0.5in hanging | 0.5in hanging | 0.5in hanging |
| Author format | Sobrenome, Nome | Last, F. M. | Last, First | Last, First |
| Title (book) | **Bold** | *Italic* | *Italic* | *Italic* |
| Title (article) | "Between quotes" | "Between quotes" | "Between quotes" | "Between quotes" |
| DOI | Optional | Required when available (`https://doi.org/...`) | Optional | Optional |

---

## Phase 1 — Write the AI prompts

### Step 1.1 — Create `n8nResources/formatting_references_prompt.md`
- **Tool:** text editor
- **Input:** the reference entry paragraphs extracted from the references section of `document.xml` (plain text, one entry per line), plus the `guideline` value
- **Output:** the same entries reformatted to match the guideline's citation format — author order, punctuation, bold/italic markers encoded as inline XML (`<w:b/>`, `<w:i/>`), DOI format
- **Notes:**
  - The prompt must handle the four source types most common in theses: book, journal article, book chapter, website
  - If the format of an entry is ambiguous, leave it as-is rather than guess
  - Output must be valid XML fragments (one `<w:p>` per entry) ready to splice back into `document.xml`
  - The prompt receives entries one section at a time, not the whole document

### Step 1.2 — Create `n8nResources/formatting_headings_prompt.md`
- **Tool:** text editor
- **Input:** one chunk's compact descriptors `[{ i, text, style, bold, len }]` plus the `context` line (last 1–2 headings before the chunk) and `guideline` — produced by the Step D chunker, not raw XML
- **Output:** a JSON array of **decisions** only — `[{ i, role: "title" | "h1" | "h2" | "h3" | "body" }]`. The model never emits XML; the deterministic merge node applies these by index.
- **Notes:** only reclassify where confidence is high (short line, all-caps, numbered like "1.", "1.1", "Capítulo 1"). If unsure, return `role: "body"` (leave as-is). Echo every `i` it was given so the merge map is complete.

### Step 1.3 — Define heading style names per guideline
- **Tool:** test DOCX opened in Word to inspect generated style IDs
- **Input:** Word's built-in style names for each guideline template
- **Output:** mapping table in the prompt: `Heading1`, `Heading2`, `Heading3` → chapter, section, subsection per guideline

---

## Phase 2 — Build the n8n formatting pipeline

### Step 2.1 — Unzip and extract files
- **Tool:** n8n Code node (JavaScript)
- **Input:** `.zip` file binary downloaded from Supabase Storage (`original_file_path`)
- **Output:** in-memory: `styles.xml` string, `document.xml` string, full zip entries map for repacking
- **Notes:** the file is stored as `.zip` (DOCX renamed at upload) — unzip with `fflate` or similar

### Step 2.2 — Step A: rewrite `styles.xml`
- **Tool:** n8n Code node (JavaScript — XML string manipulation or DOM parsing)
- **Input:** `styles.xml` string + `guideline` value from `projects` table
- **Output:** rewritten `styles.xml` with font, size, spacing, and indentation updated to guideline spec
- **Notes:** use a lookup object keyed by guideline. Only rewrite `Normal`, `Heading1`, `Heading2`, `Heading3`, `BodyText`. Leave all other styles untouched.

### Step 2.3 — Step A: strip direct formatting overrides from `document.xml`
- **Tool:** n8n Code node (JavaScript)
- **Input:** `document.xml` string
- **Output:** `document.xml` with inline layout properties removed from `<w:rPr>` and `<w:pPr>` so named styles cascade correctly
- **Notes:** preserve semantic properties: `<w:b/>`, `<w:i/>`, `<w:u/>`, color, hyperlinks. Strip only layout: `<w:sz>`, `<w:szCs>`, `<w:rFonts>`, `<w:spacing>`, `<w:ind>`, `<w:jc>` at the run/paragraph level.

### Step 2.4 — Step A: rewrite `<w:sectPr>` margins in `document.xml`
- **Tool:** n8n Code node (JavaScript)
- **Input:** `document.xml` from Step 2.3 + `guideline` value
- **Output:** `document.xml` with `<w:pgMar>` attributes updated to guideline margin values (1cm ≈ 567 twips)
- **Notes:** `<w:sectPr>` may appear at the end of `<w:body>` or inside individual sections. Handle both cases.

### Step 2.5 — Step B: detect references section
- **Tool:** n8n Code node (JavaScript)
- **Input:** `document.xml` after Step 2.4
- **Output:** the index of the paragraph that is the references heading (matched against "Referências", "References", "Works Cited", "Bibliografia", "Bibliography" — case-insensitive, trimmed), and the array of paragraphs that follow it to end of document
- **Notes:** if no references section is found, log a warning and skip Steps 2.6 and 2.7 gracefully — do not crash.
- **Server status:** implemented in `server/src/lib/formatting/references.ts` (`formatReferences`). Bounded to the **user-flagged pages** (`references_pages`), NOT word-detection — the word "Referências" can appear in body text. Flagged page numbers are mapped to paragraphs via pagination signals (manual page breaks, `sectPr`, `lastRenderedPageBreak`, else 40-block). References live in the single stored file (separate references-file split removed); ABNT uses **no hanging indent** (flush-left) while APA/MLA/Chicago use a 0.5in hanging indent — see `specs/abnt.md` §6 and `guidelines.ts` `references`.

### Step 2.6 — Step B: apply hanging indent and spacing to reference entries
- **Tool:** n8n Code node (JavaScript — XML manipulation)
- **Input:** reference entry paragraphs from Step 2.5 + `guideline` value
- **Output:** same paragraphs with `<w:pPr>` updated: hanging indent values and inter-entry spacing per the guideline spec table above; heading paragraph gets correct heading style and alignment
- **Notes:** this is fully deterministic — no AI involved.

### Step 2.7 — Step C: AI reformat reference entries (chunked)
- **Tool:** Code node (chunk by entry) → Loop Over Items → n8n AI node (cheap/fast model — Claude Haiku or GPT-4o-mini) → Code node (merge)
- **Chunking:** group the reference entry paragraphs from Step 2.5 into chunks of N entries under the model budget; never split an entry. Each chunk carries its `chunkIndex` and the entries' absolute index range.
- **AI input/output:** reference entries (plain text, one per line) + `guideline` + prompt from Step 1.1 → reformatted entries as `<w:p>` XML fragments with correct author format, punctuation, bold/italic markup.
- **Merge:** concatenate reformatted chunks in `chunkIndex` order and splice them into `document.xml` over the range `[refStart..end]` detected in Step 2.5, replacing the originals in one shot.

### Step 2.8 — Step D: AI heading reclassification (chunked)
- **Tool:** Code node (Step D chunker) → Loop Over Items → n8n AI node (same model as Step 2.7) → Code node (apply + merge)
- **Chunking & merge:** use the chunker and apply/merge nodes defined in the **Splitting & merge strategy** section. The model returns `[{ i, role }]` decisions; the merge node rewrites only `<w:pStyle>` on the original XML by absolute index.
- **Notes:** exclude the references section from this pass (it gets its own heading treatment in Step 2.6) by passing `refStartIndex` to the chunker. No XML is reassembled from model output — decisions are applied to the original `document.xml`.

### Step 2.9 — Step E: repack into `.docx`
- **Tool:** n8n Code node (JavaScript — fflate or jszip)
- **Input:** updated `styles.xml`, updated `document.xml`, remaining zip entries untouched
- **Output:** valid `.docx` binary (zip with correct MIME structure)

### Step 2.10 — Step E: upload processed file to Supabase Storage
- **Tool:** n8n HTTP Request node
- **Input:** `.docx` binary from Step 2.9 + `project.id` + `project.user_id`
- **Output:** file at `{userId}/{projectId}/processed/{filename}.docx` in the `projects` bucket

### Step 2.11 — Step E: update project status in DB
- **Tool:** n8n Supabase node (or HTTP Request to Supabase REST API)
- **Input:** `project.id`, `processed_file_path` from Step 2.10
- **Output:** `projects` row updated: `processed_file_path` stamped, `status = ready`, `completed_at = now()`

### Step 2.12 — Service routing: run formatting and proofreading sequentially with a bifurcation condition
- **Tool:** n8n IF / Switch nodes reading `project.services`
- **Goal:** run the formatting and proofreading pipelines sequentially on the same file, gated by which services the project actually ordered. Decisions are driven by checking `project.services` at two branch points.
- **Branch logic:**
  - **Both `formatting` + `proofreading`:** follow the entire pipeline — formatting first, then proofreading on the formatted output.
  - **Proofreading only:** skip the formatting section entirely and run the file straight through the proofreading pipeline.
  - **Formatting only:** start the formatting flow; once formatting finishes, a second project-services check makes the flow skip the proofreading pipeline and finish the whole processing.
- **Output:** one processed file written back regardless of path, with the same repack → upload → stamp DB steps (2.9–2.11) at the end of whichever branch runs last.

---

## Phase 3 — Prepare test assets

### Step 3.1 — Create `test_assets/formatting_test_input.docx`
- **Tool:** Microsoft Word or LibreOffice
- **Input:** 2–3 pages of academic text in Portuguese
- **Intentional violations to include:**
  - Wrong font (Arial throughout instead of Times New Roman)
  - Single spacing instead of 1.5
  - No paragraph indentation
  - Chapter titles styled as `Normal` instead of `Heading1`
  - Wrong margins (default Word margins)
  - Direct font size overrides on individual paragraphs
  - References section at the end with entries in mixed/wrong formats (some ABNT, some APA, some missing DOIs)
- **Output:** saved DOCX committed to repo at `test_assets/`

### Step 3.2 — Inspect raw XML before processing
- **Tool:** terminal
  ```sh
  unzip -p test_assets/formatting_test_input.docx word/document.xml | xmllint --format - | head -150
  unzip -p test_assets/formatting_test_input.docx word/styles.xml | xmllint --format -
  ```
- **Input:** test DOCX
- **Output:** readable XML confirming which violations are present and where they are encoded; locate the references section in the XML

---

## Phase 4 — Unit test each n8n node

### Step 4.1 — Test Step 2.2 in isolation (styles.xml rewrite)
- **Tool:** n8n "Execute node"
- **Input:** raw `styles.xml` from Step 3.2 + `guideline = "abnt"`
- **Expected output:** `Normal` has Times New Roman 12pt, 1.5 spacing, 1.25cm first-line indent; `Heading1` has Arial 12pt bold

### Step 4.2 — Test Step 2.3 in isolation (strip direct overrides)
- **Tool:** n8n "Execute node"
- **Input:** raw `document.xml` from Step 3.2
- **Expected output:** `<w:sz>`, `<w:rFonts>`, `<w:spacing>` removed from runs and paragraphs; `<w:b/>`, `<w:i/>` preserved

### Step 4.3 — Test Step 2.4 in isolation (margins)
- **Tool:** n8n "Execute node"
- **Input:** `document.xml` + `guideline = "abnt"`
- **Expected output:** `<w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" .../>` (3cm/2cm in twips)

### Step 4.4 — Test Steps 2.5 & 2.6 in isolation (references detection + XML formatting)
- **Tool:** n8n "Execute node"
- **Input:** `document.xml` containing a "Referências" heading followed by 3 entries + `guideline = "abnt"`
- **Expected output:** heading paragraph styled correctly; entry paragraphs have correct hanging indent and spacing values; no text altered

### Step 4.5 — Test Step 2.7 in isolation (AI reference reformatting)
- **Tool:** n8n "Execute node"
- **Input:** 3 reference entries in mixed format + `guideline = "abnt"`
- **Expected output:** all entries in ABNT format — SOBRENOME in caps, bold title for books, correct punctuation; original entries not duplicated

### Step 4.6 — Test Step 2.8 in isolation (AI heading reclassification)
- **Tool:** n8n "Execute node"
- **Input:** paragraph-only XML slice with 2 body paragraphs + 1 obvious chapter title styled as `Normal`
- **Expected output:** chapter title has `<w:pStyle w:val="Heading1"/>`, body paragraphs unchanged

### Step 4.7 — Test full repack (Step 2.9)
- **Tool:** terminal — open repacked file in Word/LibreOffice
- **Input:** all updated XML strings
- **Expected output:** file opens without errors; formatting visually matches guideline spec; references section correctly formatted

---

## Phase 5 — End-to-end test

### Step 5.1 — Submit a formatting order through the UI
- **Tool:** FormaTexto local dev + n8n
- **Input:** `formatting_test_input.docx`, service = Formatting, guideline = ABNT, 1 page (free trial)
- **Expected output:** project created in Supabase with `status = pending`; file in Storage at `original/`

### Step 5.2 — Confirm n8n picks up the webhook
- **Tool:** n8n execution log
- **Expected output:** execution starts within seconds of project insert; file downloaded from Storage successfully

### Step 5.3 — Verify processed file written back
- **Tool:** Supabase Dashboard → Storage → `projects` bucket
- **Expected output:** file at `processed/`; `projects.processed_file_path` stamped; `status = ready`; `completed_at` set

### Step 5.4 — Download and inspect from the UI
- **Tool:** ProjectDetailPage → "Baixar Arquivo Final"
- **Expected output:** `.docx` opens correctly; Times New Roman 12pt; 1.5 spacing; correct ABNT margins; chapter titles in Heading1; references section with ABNT-formatted entries and correct hanging indent; text content identical to input outside the references section

---

## Phase 6 — Edge cases

### Step 6.1 — Document with no references section
- **Input:** DOCX with no "Referências" / "References" heading
- **Expected:** Steps B and C skipped gracefully; rest of pipeline completes normally

### Step 6.2 — Document with no headings
- **Input:** DOCX with only body paragraphs
- **Expected:** formatting applied, AI heading pass finds nothing to reclassify, no crash

### Step 6.3 — Document with mixed languages (PT + EN)
- **Input:** DOCX with Portuguese and English paragraphs; references in English
- **Expected:** formatting applied uniformly, text untouched, reference reformatting preserves language

### Step 6.4 — Combined formatting + proofreading order
- **Input:** `services = ['formatting', 'proofreading']`
- **Expected:** formatting pipeline runs first (including references), then proofreading runs on the formatted output; single processed file delivered

### Step 6.5 — Large document (50+ pages)
- **Input:** full thesis-length DOCX
- **Expected:** pipeline completes without timeout. Deterministic Steps A/B handle the full file in one pass. Steps C and D run chunked per the **Splitting & merge strategy** — verify chunk boundaries never split a `<w:p>`, merge restores correct order, and heading levels stay consistent across chunk boundaries (the context line carries prior headings). Confirm the n8n execution timeout is raised and DB status is updated asynchronously.

### Step 6.6 — All four guidelines
- **Input:** same test DOCX, one run per guideline
- **Expected:** diff the four outputs — margins, spacing, heading font, and reference formatting all vary correctly per guideline

---

## Open questions

- [ ] Which AI model for Steps 2.7 and 2.8? (should be cheap and fast — Claude Haiku or GPT-4o-mini)
- [ ] Trigger ownership: backend push (new `/api/processing/start`), n8n polling, or a Supabase DB webhook on `projects` insert? No trigger exists yet — `webhook.ts` only handles Stripe.
- [ ] Confirm `NODE_FUNCTION_ALLOW_EXTERNAL` includes `fflate` and can add `fast-xml-parser` on the n8n host.
- [ ] What is the current n8n execution timeout, and is queue mode available for concurrent jobs?
- [ ] Should `completed_at` be stamped by n8n or by a Supabase trigger?
- [ ] Chunk budget tuning: confirm `MAX_CHARS` per chunk against the chosen model's context window; decide Loop Over Items batch size for rate limits.
- [ ] Add the observability columns (`processing_started_at`, `error_message`, `processing_stage`) to `projects`, or defer?
