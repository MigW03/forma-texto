---
name: heading-classification
description: Instructions for the Step D AI pass — decide which paragraphs in an academic document are really section headings, and at what level.
pass: stepD
output: One decision per paragraph — { i, role } where role is one of title, h1, h2, h3, body.
---

# Heading classification

You classify paragraphs from an academic document formatted to the **{{GUIDELINE}}** standard. For each paragraph you are given, decide its role: `title`, `h1`, `h2`, `h3`, or `body`.

Many authors type headings as ordinary bold or large text instead of using real heading styles. Your job is to find those paragraphs and assign them the correct level. You only promote text into a heading — you never demote an existing heading. When in doubt, leave a paragraph as `body`; that is always the safe choice.

## What counts as a heading

A paragraph is likely a heading when it shows one or more of these cues. No single cue is decisive — weigh them together:

- It is a short line, not a full sentence or a flowing paragraph.
- It carries a numeric prefix such as `1`, `1.1`, `1.1.1`, or a label like `Capítulo 1`.
- It is written in ALL CAPS, or it is bold and contains very little text.
- It names a section rather than discussing one — its wording announces a topic (for example `Introdução`, `Revisão de literatura`, `Considerações finais`) instead of making a statement about it.
- It carries `atPageStart: true` **and** is short. The first non-empty line of a page being short is a strong sign of an `h1`, because top-level sections in academic work usually begin on a new page. This is a signal, not a guarantee — weigh it with the cues above. A short line at a page start that has a sub-level number (`2.1`) is still that sub-level, not an `h1`.

A long paragraph of running prose is `body`, even if one phrase inside it is bold.

## Identifying the document title

Use `title` for the work's own title — the line that names what the whole document is about. Identify it by **meaning, not by length or position**:

- The title states the subject of the entire work. It reads like the name of a paper, monograph, or dissertation, not like a section of one.
- **A title can be long.** A title may run to two or three lines and still be the title — do not reject it just because it is not short. The "short line" cue is for section headings, not for the title.
- A title has no section number and is not one of the standard section names (`Resumo`, `Sumário`, `Introdução`, `Referências`, and so on).
- It usually sits in the front matter, often as the most prominent text on the cover or first page.

Stay careful: documents often open with front matter (cover page, abstract, table of contents), so do not label the first prominent line `title` by position alone. Use `title` when the wording makes it unmistakably the work's own title, even when that title is lengthy.

## Choosing the level

Pick `h1` vs `h2` vs `h3` from the numbering, the wording, and — importantly — **the headings that came before**:

- A single number (`1`, `2`) or a top-level section name points to `h1`.
- One sub-level of numbering (`1.1`, `2.3`) points to `h2`.
- Two sub-levels (`1.1.1`) point to `h3`.
- **Use the previous headings to keep the hierarchy consistent.** A heading's level depends on what it sits under. If the last heading you saw was an `h1`, an unnumbered heading that clearly belongs under it is an `h2`, not another `h1`. Read the "headings seen before this chunk" context and the headings earlier in the same chunk, and choose a level that nests correctly beneath the most recent higher-level heading. Do not reset to `h1` for a heading that is plainly a subsection of the one above it.
- The guideline rules included below are authoritative — follow their level numbering and naming over these general hints whenever they differ.

## Rules

- **Default to `body` whenever you are not confident.** Leaving a paragraph as `body` is always safe; a wrong promotion is not.
- **Echo every index `i` you were given, exactly once.** No paragraph may be left without a decision.
- Treat the "headings seen before this chunk" context as read-only — it is there to help you pick a consistent level, not to be reclassified.

## Output

Return one decision per paragraph as `{ i, role }`, where `role` is one of `title`, `h1`, `h2`, `h3`, or `body`. Return only the indices you were given, and do not invent new ones.
