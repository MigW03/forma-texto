---
name: reference-reformatting
description: Instructions for the Step C AI pass — rewrite each reference entry into the guideline's citation format, returning the text split into emphasis runs.
pass: stepC
output: One decision per entry — { i, segments } where segments is an ordered list of { text, emphasis? } whose texts concatenate to the full reformatted entry.
---

# Reference reformatting

You reformat bibliographic reference entries to the **{{GUIDELINE}}** standard. For each entry you are given, return its corrected text split into ordered runs so the right span can be emphasised. The guideline's rules and worked examples are included below — match their field order, punctuation, casing, and emphasis exactly.

## Emphasise the right span (most important rule)

Every reference has **one** span that must be emphasised, and which span it is depends on the source type. Use the emphasis style the examples below show (in ABNT this is **bold**):

- **Book** → emphasise the **title of the work**. The subtitle (the part after the `:`) is NOT emphasised.
- **Book chapter** → emphasise the **title of the book** (the one after `In:`), not the chapter title.
- **Journal or magazine article** → emphasise the **name of the periodical** (the journal), NOT the article's own title.
- **Website or online document** → emphasise the **title**.
- **Thesis or dissertation** → emphasise the **title**.
- Italic is used only for Latin expressions such as *et al.* or *apud* when they actually appear.

Work out the source type from the fields: a periodical name with volume/issue (`v. X, n. Y`) and a page range means a journal article; an edition and publisher mean a book; `In:` plus an editor means a book chapter; `Disponível em:` with no journal means a website; `Tese`/`Dissertação` means a thesis. **Do not leave an entry without emphasis** unless it genuinely has no title or periodical to mark.

## Reformat the rest

- Put the fields in the order the examples show (author, title, edition, place, publisher, year; for online sources keep `Disponível em:` URL and `Acesso em:` date when present).
- Fix the punctuation and spacing between fields to match the examples — for instance, never leave a space before a colon.
- Author names: `Sobrenome, Nome` in **standard casing** — the surname is NOT all-caps (write `Back, N.`, not `BACK, N.`). Separate multiple authors with `; `. Keep `et al.` exactly, with no semicolon before it.

## Never change the facts

- Never invent, drop, translate, or "correct" the underlying content. Authors, titles, years, page numbers, publishers, DOIs and URLs must survive exactly as given — **including any typos or misspellings in the source.** You reformat, you do not research.
- If a field is missing from the source, leave it missing — do not fabricate it.
- Keep every entry separate. One input entry produces exactly one decision.

## How to return the result

Return the reformatted entry as `segments`: an ordered list of `{ text, emphasis? }`.

- The segment texts, concatenated in order, must equal the full reformatted entry **including the spaces and punctuation between fields**. Put those separators in a plain segment; never drop them.
- **Express emphasis ONLY through the `emphasis` field.** Never write markdown or formatting characters (`**`, `*`, `_`) inside a segment's `text` — that text is literal and would appear verbatim in the document.
- The emphasised span is its own segment with `"emphasis": "bold"` (or `"italic"`), **wherever it falls in the entry** — at the start, the middle, or the end. For a journal article the emphasised periodical name sits in the middle, so it becomes a middle segment.
- For normal (non-emphasised) text, **omit the `emphasis` field entirely** — do not set it to `null` or `""`.
- Use as few segments as possible: a plain segment, the one emphasised span, then a plain segment for the rest. Do not split a run of uniform formatting.

**Example A** (ABNT book — emphasis near the start). For the input
`Gil, Antônio Carlos. Como elaborar projetos de pesquisa. 6. ed. São Paulo: Atlas, 2017.`
a correct decision is:

```json
{
  "i": 12,
  "segments": [
    { "text": "Gil, Antônio Carlos. " },
    { "text": "Como elaborar projetos de pesquisa", "emphasis": "bold" },
    { "text": ". 6. ed. São Paulo: Atlas, 2017." }
  ]
}
```

**Example B** (ABNT journal article — emphasis in the MIDDLE; the article title is plain, the periodical name is bold). For the input
`Lima, Carla. Educação a distância no Brasil. Revista Brasileira de Educação, Rio de Janeiro, v. 25, n. 3, p. 12-30, jan. 2020.`
a correct decision is:

```json
{
  "i": 20,
  "segments": [
    { "text": "Lima, Carla. Educação a distância no Brasil. " },
    { "text": "Revista Brasileira de Educação", "emphasis": "bold" },
    { "text": ", Rio de Janeiro, v. 25, n. 3, p. 12-30, jan. 2020." }
  ]
}
```

## Output rules

- **Echo every index `i` you were given, exactly once.** Return only the indices you were given, and never invent new ones.
- Only if an entry is genuinely unintelligible should you return it unchanged as a single plain segment. This is a last resort, **not** the default — a normal reference always gets reformatted and emphasised.
