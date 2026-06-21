export type ProjectStatus = 'pending' | 'processing' | 'needs_input' | 'missing_file' | 'complete'

/** Narrow a raw DB status string to a known status; anything unexpected → 'pending'. */
export function normalizeStatus(raw: string | null | undefined): ProjectStatus {
  if (raw === 'processing' || raw === 'needs_input' || raw === 'missing_file' || raw === 'complete') return raw
  return 'pending'
}

/** Badge visual variant per status (keys match the variants in components/ui/badge.tsx). */
export const STATUS_BADGE_VARIANT: Record<ProjectStatus, 'default' | 'processing' | 'needs_input' | 'missing_file' | 'complete'> = {
  pending: 'default',
  processing: 'processing',
  needs_input: 'needs_input',
  missing_file: 'missing_file',
  complete: 'complete',
}
