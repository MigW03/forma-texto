/**
 * Project lifecycle status — the single source of truth for the frontend.
 *
 * These are exactly the values the backend writes to `projects.status`
 * (`processFormatting.ts`): a project is inserted `pending`, moves to
 * `processing`, optionally pauses at `needs_input` (when caption placeholders
 * were inserted), and ends `complete`. The UI uses the same vocabulary — no
 * separate display enum — so there is one term per state across the codebase.
 */
export type ProjectStatus = 'pending' | 'processing' | 'needs_input' | 'complete'

/** Narrow a raw DB status string to a known status; anything unexpected → 'pending'. */
export function normalizeStatus(raw: string | null | undefined): ProjectStatus {
  if (raw === 'processing' || raw === 'complete' || raw === 'needs_input') return raw
  return 'pending'
}

/** Badge visual variant per status (keys match the variants in components/ui/badge.tsx). */
export const STATUS_BADGE_VARIANT: Record<ProjectStatus, 'default' | 'processing' | 'needs_input' | 'complete'> = {
  pending: 'default',
  processing: 'processing',
  needs_input: 'needs_input',
  complete: 'complete',
}
