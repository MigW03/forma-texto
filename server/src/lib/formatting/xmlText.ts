/**
 * Shared text->XML helpers for the AI splice points (Step C reference rendering,
 * Step P proofread run replacement).
 *
 * `escapeXml` must do two jobs, not one:
 *  1. Escape the markup-significant characters `& < >`.
 *  2. Strip characters that are **illegal in XML 1.0** before they reach the
 *     document. AI models occasionally emit a stray control character — a NUL
 *     byte once corrupted a Step C reference splice in production
 *     (the model returned a NUL inside a reference entry, e.g. before "ABNT."),
 *     and because NUL is not a valid XML char the *entire* `document.xml` became
 *     unparseable, so docx-preview rendered nothing and the viewer went blank.
 *     Escaping alone doesn't catch this; control chars aren't markup, they're
 *     simply forbidden, so they have to be removed.
 *
 * Illegal C0 set = everything below U+0020 except tab (U+0009), newline (U+000A)
 * and carriage return (U+000D), plus the non-characters U+FFFE/U+FFFF. We do NOT
 * touch the surrogate range so valid astral characters (emoji etc.) survive.
 */
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

/** Remove characters that XML 1.0 forbids outright (keeps \t \n \r). */
export const stripInvalidXmlChars = (s: string): string => s.replace(INVALID_XML_CHARS, '')

/** Strip XML-illegal chars, then escape `& < >`. Use for any model-authored text. */
export const escapeXml = (s: string): string =>
  stripInvalidXmlChars(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Decode the XML entities Word (or any valid XML writer) uses for markup-significant
 * characters inside `<w:t>` text — a literal `&`, `<` or `>` can never appear raw in
 * XML text content, so the source always carries `&amp;`/`&lt;`/`&gt;` etc. instead.
 * Any consumer that wants the actual displayed text — heading/classification regexes,
 * the sumário's rebuilt TOC entries (which re-escape via `escapeXml` before
 * splicing) — must decode these back first, or a plain `&` round-trips as the
 * literal string `&amp;` after re-escaping (double-encoded). `&amp;` is decoded LAST
 * so an already-decoded `&` is never re-interpreted as the start of another entity.
 */
export const decodeXmlEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
