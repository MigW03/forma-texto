# DOCX Formatting — Implementation & Test Plan

## Architecture

Formatting is split into deterministic XML passes (no AI) and two targeted AI passes. This keeps cost low — AI only handles the parts that require semantic understanding.

```
DOCX formatting pipeline
├── Step A (no AI): rewrite styles.xml + strip direct overrides + fix margins
├── Step B (no AI): detect references section + apply hanging indent + spacing
├── Step C (AI):    reformat reference entries to guideline citation format
├── Step D (AI):    reclassify headings in document.xml
└── Step E (no AI): repack → upload → stamp DB
```

Proofreading runs as a separate branch (same repack/upload/stamp step at the end). When both services are selected, formatting and proofreading run sequentially on the same file — formatting first, then proofreading on the formatted output.

---

## Guideline Specs

### Body & layout — applied in Step A

| Property | ABNT | APA 7th | MLA 9th | Chicago 17th |
|---|---|---|---|---|
| Font | Times New Roman | Times New Roman | Times New Roman | Times New Roman |
| Body size | 12pt | 12pt | 12pt | 12pt |
| Line spacing | 1.5 | Double (2.0) | Double (2.0) | Double (2.0) |
| Paragraph indent | 1.25cm first line | 0.5in first line | 0.5in first line | 0.5in first line |
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
- **Input:** `word/document.xml` XML (paragraphs only — strip non-paragraph nodes before sending to reduce tokens)
- **Output:** same XML with corrected `<w:pStyle w:val="..."/>` values on paragraphs that are clearly chapter titles, section headings, or subheadings — text content unchanged, all other attributes unchanged
- **Notes:** only reclassify where confidence is high (short line, all-caps, numbered like "1.", "1.1", "Capítulo 1"). If unsure — leave as-is.

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

### Step 2.6 — Step B: apply hanging indent and spacing to reference entries
- **Tool:** n8n Code node (JavaScript — XML manipulation)
- **Input:** reference entry paragraphs from Step 2.5 + `guideline` value
- **Output:** same paragraphs with `<w:pPr>` updated: hanging indent values and inter-entry spacing per the guideline spec table above; heading paragraph gets correct heading style and alignment
- **Notes:** this is fully deterministic — no AI involved.

### Step 2.7 — Step C: AI reformat reference entries
- **Tool:** n8n AI node (cheap/fast model — Claude Haiku or GPT-4o-mini)
- **Input:** reference entry paragraphs (plain text, one per line) + `guideline` + prompt from Step 1.1
- **Output:** reformatted entries as `<w:p>` XML fragments with correct author format, punctuation, bold/italic inline markup
- **Notes:** merge reformatted entries back into `document.xml` at the position detected in Step 2.5, replacing the original entries.

### Step 2.8 — Step D: AI heading reclassification
- **Tool:** n8n AI node (same cheap/fast model as Step 2.7)
- **Input:** paragraph-only slice of `document.xml` (excluding the references section) + guideline + prompt from Step 1.2
- **Output:** same XML slice with corrected `<w:pStyle>` values on heading paragraphs
- **Notes:** exclude the references section from this pass — it has its own heading treatment in Step 2.6. Merge result back into full `document.xml`.

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
- **Output:** `projects` row updated: `processed_file_path` stamped, `status = complete`, `completed_at = now()`

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
- **Expected output:** file at `processed/`; `projects.processed_file_path` stamped; `status = complete`; `completed_at` set

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
- **Expected:** pipeline completes without timeout; check n8n timeout setting and AI model context window for Steps 2.7 and 2.8 — large reference lists may need to be batched

### Step 6.6 — All four guidelines
- **Input:** same test DOCX, one run per guideline
- **Expected:** diff the four outputs — margins, spacing, heading font, and reference formatting all vary correctly per guideline

---

## Open questions

- [ ] Which AI model for Steps 2.7 and 2.8? (should be cheap and fast — Claude Haiku or GPT-4o-mini)
- [ ] Does the n8n webhook currently fire on `projects` insert or does it need a separate trigger?
- [ ] What is the current n8n execution timeout? Large reference lists in Step 2.7 may need batching.
- [ ] Should `completed_at` be stamped by n8n or by a Supabase trigger?
- [ ] Should the references AI pass (Step 2.7) send all entries in one prompt or batch by entry type (book, article, etc.)?
