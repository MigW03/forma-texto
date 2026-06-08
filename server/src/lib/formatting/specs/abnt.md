# Formatting Guideline Spec — ABNT

> **Canonical, machine- and AI-readable specification for the ABNT academic formatting standard.**
> This is the single source of truth consumed by BOTH the deterministic XML passes
> (Step A/B) and the AI passes (Step C/D) of the FormaTexto formatting pipeline.
> It is the **template** for all other guideline spec files (APA, MLA, Chicago).

- **Standard:** ABNT (Associação Brasileira de Normas Técnicas)
- **Primary norms:** NBR 14724 (document presentation), NBR 6023 (references), NBR 10520 (citations), NBR 6024 (section numbering)
- **Language:** Portuguese (Brazil)
- **Spec version:** 1.1 — author surnames in references now use standard name casing (no longer uppercase)
- **Units used below:** twips (`1 cm = 567 twips`, `1 in = 1440 twips`); font size in half-points (`12 pt = 24`); line spacing in twentieths of a point (`single = 240`, `1.5 = 360`, `double = 480`).

---

## 0. How to use this file

- **Deterministic steps (Step A/B, no AI):** read the values in [§8 Machine-readable values](#8-machine-readable-values). They map 1:1 to WordprocessingML attributes. Do not infer — use the numbers verbatim.
- **AI steps (Step C/D):** read the prose rules (§1–§6) and the [§7 Reference examples](#7-reference-examples). Use the examples as formatting templates. When unsure, prefer leaving content unchanged over guessing.
- **Each rule is tagged** with who enforces it: `[DET]` deterministic, `[AI]` AI pass, `[BOTH]`.

---

## 1. Page layout `[DET]`

| Property | Value | Twips |
|---|---|---|
| Paper size | A4 (210 × 297 mm) | 11906 × 16838 |
| Margin — top (superior) | 3 cm | 1701 |
| Margin — left (esquerda) | 3 cm | 1701 |
| Margin — bottom (inferior) | 2 cm | 1134 |
| Margin — right (direita) | 2 cm | 1134 |

---

## 2. Fonts `[DET]`

ABNT accepts **two** font families — **Times New Roman** and **Arial**. Both are fully compliant; the choice of *which one* is the user's.

| Role | Accepted families | Default |
|---|---|---|
| Whole document (body + headings) | **Times New Roman**, **Arial** | Times New Roman |

**Rules:**
- **Exactly one** family is used throughout the entire document — body, headings, and captions all share it. The user picks Times New Roman **or** Arial; that single choice then applies everywhere. The two families are never mixed within one document.
- Headings are therefore **not** distinguished by a different family — only by size policy, **bold**, CAPS, and numbering (see §4).
- **Font selection policy:**
  1. If the user explicitly chose a font, use it (must be one of the accepted families).
  2. Else, if the source document already uses one accepted family consistently, keep it.
  3. Else, default to **Times New Roman**.
- A font outside the accepted list is replaced by the default.

### Font sizes

| Element | Size (pt) | Half-points |
|---|---|---|
| Body text | 12 | 24 |
| Headings (all levels) | 12 | 24 |
| Long quotations (> 3 lines) | 10 | 20 |
| Footnotes | 10 | 20 |
| Captions / sources of figures & tables | 10 | 20 |
| Page numbers | 10 | 20 |

---

## 3. Paragraph & spacing `[DET]`

| Property | Body text | Long quote (> 3 lines) | Footnotes | References |
|---|---|---|---|---|
| Line spacing | 1.5 (`360`) | single (`240`) | single (`240`) | single (`240`) |
| Alignment | Justified (`both`) | Justified (`both`) | Justified | **Left** (`left`) |
| First-line indent | 1.25 cm (`709`) | none | none | none |
| Left indent | 0 | 4 cm (`2268`) | 0 | 0 |
| Space between paragraphs | 0 | 0 | 0 | one blank line between entries |

> Long quotations also drop the quotation marks and are set apart as their own block.

---

## 4. Headings / section titles `[BOTH]`

Sections are numbered progressively with Arabic numerals (NBR 6024): `1`, `1.1`, `1.1.1`, … Titles **without** a numeric indicator (e.g. `REFERÊNCIAS`, `RESUMO`, `SUMÁRIO`) are **centered** and unnumbered.

Heading levels map to Word styles `Heading1`/`Heading2`/`Heading3`. The differentiation scheme below is the most widely used; some institutions vary — apply only when confidence is high.

| Level | Word style | Case | Weight | Alignment | Notes |
|---|---|---|---|---|---|
| 1 — Primary (`1`) | `Heading1` | UPPERCASE | **bold** | left | starts on a new page |
| 2 — Secondary (`1.1`) | `Heading2` | UPPERCASE | regular | left | |
| 3 — Tertiary (`1.1.1`) | `Heading3` | Sentence case | **bold** | left | |
| Unnumbered titles | (special) | UPPERCASE | **bold** | **center** | e.g. REFERÊNCIAS |

- `[DET]` Uppercase display is applied via the `<w:caps/>` run property (non-destructive — the underlying text is preserved).
- `[DET]` The **document title** (`Title` style) is always: **no indentation** (`w:ind w:left="0" w:firstLine="0"`), **UPPERCASE** (`<w:caps/>`), **bold**, **centered**, same font as body. This formatting is fully deterministic and must NOT be left to the AI.
- **Title detection is NOT automated.** The `Title` style is only corrected where the author already applied it. We deliberately do not guess the title from position, because documents often begin with front matter (cover, abstract/resumo, sumário) that is not the title. If automatic detection is added later, it must account for front matter.
- `[AI]` Deciding **which** paragraphs are headings (and at what level) when the author typed them as normal bold/large text is the job of the Step D AI pass. Cues: short line, all-caps, numeric prefix (`1`, `1.1`, `Capítulo 1`).

---

## 5. In-text citations `[AI]`

- Author–date system (autor-data): `(SOBRENOME, ano)` or `Sobrenome (ano)`.
- Direct quote up to 3 lines: inline, between double quotation marks, with `(SOBRENOME, ano, p. X)`.
- Direct quote over 3 lines: long-quote block per §3.
- Do not alter citations unless reformatting is clearly required and unambiguous.

---

## 6. References section `[BOTH]`

| Property | Value |
|---|---|
| Heading text | `REFERÊNCIAS` |
| Heading format | UPPERCASE, **bold**, **centered**, unnumbered |
| Ordering | Alphabetical by first author surname (sistema alfabético) |
| Entry alignment | Left (ragged right) |
| Line spacing within an entry | single (`240`) |
| Separation between entries | one blank line |
| Hanging indent | none (entries flush to the left margin) |
| Title emphasis | the title of the work is in **bold** (subtitle not bold) |
| Author format | `Sobrenome, Nome` (standard name casing — surname **not** uppercase) |

- `[DET]` **The references section is located by the user-flagged pages** (`references_pages`), NOT by scanning for the word "Referências" (which can occur in body text). DOCX has no page-number metadata, so flagged page numbers are mapped to paragraphs using the document's pagination signals — manual `<w:br w:type="page"/>`, inline `<w:sectPr>`, then `<w:lastRenderedPageBreak/>`, falling back to a 40-block heuristic. Within the flagged region, the first non-empty paragraph is the heading. The whole document — including references — lives in one stored file (references are no longer sliced out separately). Page boundaries in flow-based docs are inherently approximate; the user's page flags are the source of truth for *which* pages, the pagination markers for *where* they split.
- `[DET]` Heading formatting (style `ReferencesHeading`: centered, bold, UPPERCASE), entry alignment, spacing, hanging-indent = none.
- `[AI]` Reformatting each entry's internal structure (author order, punctuation, bold/italic, DOI) per §7.

---

## 7. Reference examples

These are **templates for the AI** (Step C). Each shows the abstract **pattern** and a concrete **example**, defining the field order, punctuation, and which span is emphasised. In the examples below, the emphasised span is written in **bold** purely so you can see which span it is — that is the span you mark with `"emphasis": "bold"` in your `segments` output. Step C returns each entry as text segments with an `emphasis` field, exactly as described in the task instructions above. **Do not output XML, and do not copy the `**` markers into a segment's text.**

> Emphasis convention in ABNT: the **title of the work** is emphasised (bold). Italic is used only for foreign/Latin terms (e.g. *et al.*, *apud*).
> **Author names use standard name casing** — `Sobrenome, Nome` (the surname is NOT uppercased). Institutional/acronym authors keep their natural casing (e.g. `IBGE`).

### 7.1 Book
**Pattern:** `Sobrenome, Nome. **Título**: subtítulo. Edição. Local: Editora, ano.`
**Example:**
> Gil, Antônio Carlos. **Como elaborar projetos de pesquisa**. 6. ed. São Paulo: Atlas, 2017.

### 7.2 Book chapter (in an edited volume)
**Pattern:** `Sobrenome, Nome. Título do capítulo. In: Sobrenome, Nome (org.). **Título do livro**. Local: Editora, ano. p. inicial-final.`
**Example:**
> Santos, Maria. A pesquisa qualitativa. In: Oliveira, João (org.). **Métodos de pesquisa**. São Paulo: Cortez, 2019. p. 45-67.

### 7.3 Journal article
**Pattern:** `Sobrenome, Nome. Título do artigo. **Nome da Revista**, Local, v. X, n. Y, p. inicial-final, mês ano.`
**Example:**
> Lima, Carla. Educação a distância no Brasil. **Revista Brasileira de Educação**, Rio de Janeiro, v. 25, n. 3, p. 12-30, jan. 2020.

### 7.4 Website / online document
**Pattern:** `Sobrenome, Nome. **Título**. Ano. Disponível em: URL. Acesso em: dia mês ano.`
**Example:**
> IBGE. **Censo demográfico 2022**. 2023. Disponível em: https://www.ibge.gov.br/censo. Acesso em: 15 mar. 2024.

### 7.5 Thesis / dissertation
**Pattern:** `Sobrenome, Nome. **Título**: subtítulo. Ano. Tipo (Grau em Área) — Instituição, Local, ano.`
**Example:**
> Costa, Pedro. **Análise de redes sociais**. 2021. Tese (Doutorado em Ciência da Computação) — Universidade de São Paulo, São Paulo, 2021.

### 7.6 Article with DOI (DOI optional in ABNT)
**Example:**
> Nunes, Ana. Aprendizado de máquina aplicado à saúde. **Revista de Informática Médica**, São Paulo, v. 10, n. 1, p. 5-22, 2022. DOI: https://doi.org/10.1234/rim.2022.001.

---

## 8. Machine-readable values

**This block is the live source of truth.** At runtime `getGuideline('abnt')` (`server/src/lib/formatting/loadGuideline.ts`) reads *this file*, extracts the fenced block below, parses it (JSON5), validates it (zod), and feeds the deterministic passes. **Edit the values here and the next formatting job picks them up — no rebuild, no restart** (the loader re-reads when this file's mtime changes). A malformed edit is caught by `loadGuideline.test.ts` (`npm test`) before it can reach a job; if the file is ever unreadable, the pipeline falls back to the built-in table in `guidelines.ts`. The §1–§6 tables above are the human-readable mirror — keep them in sync when you edit the block.

> **Note for human reviewers:** the values below are in Word's internal units. The `//` comments translate them to centimeters / points so they can be reviewed at a glance. This makes the block **JSONC**, parsed by JSON5 (comments and trailing commas are fine; do not put `//` inside a string value).
>
> **Conversions:** `1 cm = 567 twips` · `1 in = 1440 twips` · font size is in **half-points** (`24 = 12 pt`) · line spacing is in **twentieths of a point** (`240 = single`, `360 = 1.5`, `480 = double`).

```jsonc
{
  "id": "abnt",
  "label": "ABNT",
  "language": "pt-BR",
  // `display` drives the project-creation dropdown. The id (= this file's name)
  // is the stored/lookup key. The name is universal (guideline names don't
  // translate); the description is localized per UI locale. Add a new spec file
  // with its own `display` block and it appears in the dropdown automatically.
  "display": {
    "name": "ABNT NBR 14724",
    "description": {
      "en": "Brazilian academic standard",
      "pt-BR": "Padrão acadêmico brasileiro",
      "pt-PT": "Padrão académico brasileiro"
    }
  },
  "page": {
    "size": "A4",
    "widthTwips": 11906,            // 21.0 cm (A4 width)
    "heightTwips": 16838,           // 29.7 cm (A4 height)
    "marginsTwips": {
      "top": 1701,                  // 3 cm
      "bottom": 1134,               // 2 cm
      "left": 1701,                 // 3 cm
      "right": 1134                 // 2 cm
    }
  },
  "fonts": {
    "accepted": ["Times New Roman", "Arial"],
    "default": "Times New Roman",
    "policy": "user-choice > existing-consistent > default"
  },
  "body": {
    "sizeHalfPt": 24,              // 12 pt
    "lineRule": "auto",
    "lineTwentieths": 360,         // 1.5 line spacing
    "firstLineIndentTwips": 709,   // 1.25 cm
    "align": "both"
  },
  "longQuote": {
    "sizeHalfPt": 20,              // 10 pt
    "lineTwentieths": 240,         // single spacing
    "leftIndentTwips": 2268,       // 4 cm
    "align": "both"
  },
  "footnote": { "sizeHalfPt": 20, "lineTwentieths": 240 }, // 10 pt, single spacing
  "caption":  { "sizeHalfPt": 20, "lineTwentieths": 240 }, // 10 pt, single spacing
  "headings": {
    "fontPolicy": "same-as-body",
    "sizeHalfPt": 24,             // 12 pt
    "levels": {
      "1": { "wordStyle": "Heading1", "case": "upper",    "bold": true,  "align": "left",   "newPage": true },
      "2": { "wordStyle": "Heading2", "case": "upper",    "bold": false, "align": "left",   "newPage": false },
      "3": { "wordStyle": "Heading3", "case": "sentence", "bold": true,  "align": "left",   "newPage": false }
    },
    "unnumberedTitle": { "case": "upper", "bold": true, "align": "center" }
  },
  "references": {
    "headingText": "REFERÊNCIAS",
    "headingCase": "upper",
    "headingBold": true,
    "headingAlign": "center",
    "entryAlign": "left",
    "entryLineTwentieths": 240,    // single spacing within an entry
    "betweenEntries": "blank-line",
    "order": "alphabetical",
    "authorFormat": "Sobrenome, Nome",
    "authorSurnameCase": "standard",
    "hangingIndent": false,
    "titleEmphasis": "bold"
  }
}
```

---

## 9. Pipeline responsibility checklist

### Deterministic — Step A `[DET]`
- [ ] Page margins set to 3/2/3/2 cm.
- [ ] Body style: accepted font, 12 pt, 1.5 spacing, 1.25 cm first-line indent, justified.
- [ ] Title style: never indented, uppercase (`<w:caps/>`), bold, centered, same font as body.
- [ ] Heading styles: same font as body, 12 pt, bold/caps/alignment per §4 level table.
- [ ] Strip inline layout overrides so named styles cascade.

### Deterministic — Step B `[DET]`
- [ ] Detect the references section.
- [ ] Heading `REFERÊNCIAS`: uppercase, bold, centered.
- [ ] Reference entries: left-aligned, single spacing, blank line between, no hanging indent.

### AI — Step C `[AI]`
- [ ] Reformat each reference entry per §7 (author order, punctuation, bold title, DOI).

### AI — Step D `[AI]`
- [ ] Reclassify paragraphs that are really headings (typed as normal text) into the correct `Heading1/2/3` level.

---

## 10. Known mismatches to reconcile

> Tracked here so deterministic code and this spec converge.

- ~~**Heading font** mismatch (heading Arial vs body Times).~~ **Resolved.** The loader now derives both body and heading font from a single `fonts.default` (§8), so they always match — one font throughout, per §2.
- ~~**Per-level heading case + bold** not applied in Step A (all levels looked identical).~~ **Resolved.** `rewriteStyles` now builds Heading1/2/3 from the §8 `headings.levels` block: H1 `<w:caps/>` + bold, H2 `<w:caps/>` (not bold), H3 sentence case + bold. Levels share one size (12pt) — ABNT differentiates by case + bold + numbering, not size.
- **References heading alignment:** older `formattingPlan.md` table said "left-aligned"; correct ABNT value is **centered** (§6). This spec is authoritative.
- **Unnumbered-title style** (e.g. RESUMO, SUMÁRIO via `unnumberedTitle`) is specified in §8 but not yet applied in Step A — only the `Title` style is. Implement when those front-matter headings are handled.
