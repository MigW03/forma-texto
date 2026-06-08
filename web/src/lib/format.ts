/** Small, pure formatting helpers shared across pages (and unit-tested). */

/** Relative-time bucket. Rendered to a localized string at the call site (i18n). */
export type TimeAgo =
  | { kind: 'justNow' }
  | { kind: 'hours'; count: number }
  | { kind: 'days'; count: number }

/** Bucket an ISO date into just-now (< 1h) / hours (< 24h) / days. */
export function toTimeAgo(isoDate: string): TimeAgo {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  if (diffHours < 1) return { kind: 'justNow' }
  if (diffHours < 24) return { kind: 'hours', count: diffHours }
  return { kind: 'days', count: Math.floor(diffHours / 24) }
}

/**
 * Render a set of page numbers as a compact range string, e.g.
 * `[1,2,3,5,8,9] → "1–3, 5, 8–9"`. Input is de-duplicated and sorted first.
 */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const ranges: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) { end = sorted[i] }
    else { ranges.push(start === end ? `${start}` : `${start}–${end}`); start = sorted[i]; end = sorted[i] }
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`)
  return ranges.join(', ')
}
