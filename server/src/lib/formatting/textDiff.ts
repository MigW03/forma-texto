/**
 * Minimal character-level diff used by the proofreading apply step (Step P).
 *
 * Proofreading edits are small and local (a word, an accent, a verb ending), so
 * we need a diff that ISOLATES each change rather than collapsing the whole
 * differing middle into one span — otherwise a fix at the start and a fix at the
 * end of a paragraph would be reported as one giant hunk spanning everything
 * between them (and would then be rejected for crossing a formatting boundary).
 *
 * `diff(a, b)` returns the ordered, non-overlapping edits that turn `a` into `b`,
 * each as `{ aStart, aEnd, replacement }` where `[aStart, aEnd)` is the span of
 * `a` to replace. Equal regions are left out. Pure, no dependencies.
 */

export interface Hunk {
  /** Start offset in `a` (inclusive). */
  aStart: number
  /** End offset in `a` (exclusive). Equal to `aStart` for a pure insertion. */
  aEnd: number
  /** Text to put in place of `a[aStart..aEnd)`. Empty for a pure deletion. */
  replacement: string
}

/** Cap on the LCS table size; above it we fall back to one coarse hunk (cheap, rare). */
const MAX_LCS_CELLS = 2_000_000

export function diff(a: string, b: string): Hunk[] {
  // Trim the common prefix/suffix so the LCS runs only over the differing middle.
  const minLen = Math.min(a.length, b.length)
  let p = 0
  while (p < minLen && a[p] === b[p]) p++
  let s = 0
  while (s < minLen - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++

  const am = a.slice(p, a.length - s)
  const bm = b.slice(p, b.length - s)
  if (am.length === 0 && bm.length === 0) return []
  if (am.length === 0) return [{ aStart: p, aEnd: p, replacement: bm }]
  if (bm.length === 0) return [{ aStart: p, aEnd: p + am.length, replacement: '' }]

  const n = am.length
  const m = bm.length
  // Degenerate guard: a near-total rewrite isn't worth an O(n·m) table — one hunk.
  if (n * m > MAX_LCS_CELLS) return [{ aStart: p, aEnd: p + n, replacement: bm }]

  // LCS length table, filled bottom-up. dp[i*w+j] = LCS(am[i:], bm[j:]).
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        am[i] === bm[j] ? dp[(i + 1) * w + (j + 1)] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)])
    }
  }

  // Walk the table, grouping consecutive non-equal ops into hunks (separated by
  // equal characters). Offsets are translated back to absolute `a` coordinates (+p).
  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let open = false
  let hStart = 0
  let hEnd = 0
  let repl = ''
  const openHunk = (idx: number) => {
    if (!open) { open = true; hStart = idx; hEnd = idx; repl = '' }
  }
  const closeHunk = () => {
    if (open) { hunks.push({ aStart: p + hStart, aEnd: p + hEnd, replacement: repl }); open = false }
  }

  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      closeHunk()
      i++
      j++
    } else if (j < m && (i === n || dp[i * w + (j + 1)] >= dp[(i + 1) * w + j])) {
      openHunk(i) // insertion of bm[j] at position i of am
      repl += bm[j]
      j++
    } else {
      openHunk(i) // deletion of am[i]
      hEnd = i + 1
      i++
    }
  }
  closeHunk()
  return hunks
}
