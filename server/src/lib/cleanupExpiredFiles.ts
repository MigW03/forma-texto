/**
 * File auto-deletion.
 *
 * Every project row carries `delete_files_at` (stamped 30 days after submission
 * at checkout). This job removes the stored files of any project whose deadline
 * has passed and that hasn't been cleaned yet, then stamps `files_deleted_at` so
 * it is never rescanned.
 *
 * What gets removed from the `projects` storage bucket, per project:
 *  - `original_file_path`   (the uploaded `.docx`)
 *  - `processed_file_path`  (the formatted/corrected `.docx`)
 *  - the exported PDF beside it (`processed_file_path` with a `.pdf` extension)
 *
 * The row itself is kept (order history, dashboard listing) — only the binaries
 * go. The path columns are left intact as a record; `files_deleted_at` is the
 * signal that the files are gone.
 */

const BUCKET = 'projects'

/** Minimal structural slice of the Supabase client this job uses. Lets tests
 *  inject a fake without pulling in the full client type. */
export interface CleanupClient {
  from(table: string): {
    select(cols: string): {
      lt(col: string, val: string): {
        is(col: string, val: null): Promise<{ data: ExpiredProjectRow[] | null; error: { message: string } | null }>
      }
    }
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): Promise<{ error: { message: string } | null }>
    }
  }
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ error: { message: string } | null }>
    }
  }
}

export interface ExpiredProjectRow {
  id: string
  original_file_path: string | null
  processed_file_path: string | null
}

export interface CleanupResult {
  scanned: number
  filesRemoved: number
  projectsCleaned: number
  errors: string[]
}

/** Derive every storage object owned by a project (deduped, non-null). */
export function projectStoragePaths(row: ExpiredProjectRow): string[] {
  const paths = new Set<string>()
  if (row.original_file_path) paths.add(row.original_file_path)
  if (row.processed_file_path) {
    paths.add(row.processed_file_path)
    // The PDF export lives at the same path with a `.pdf` extension.
    paths.add(row.processed_file_path.replace(/\.docx$/i, '.pdf'))
  }
  return [...paths]
}

/**
 * Remove expired project files and stamp `files_deleted_at`.
 *
 * Non-fatal per project: a storage failure on one project is recorded in
 * `errors` and the row is left unstamped so the next run retries it; other
 * projects still get cleaned.
 */
export async function cleanupExpiredFiles(
  client?: CleanupClient,
  now: Date = new Date(),
): Promise<CleanupResult> {
  // Lazy-load the real client only when no fake is injected — keeps the unit
  // tests from importing supabase.ts (which throws without env vars).
  if (!client) {
    client = (require('./supabase') as { supabase: unknown }).supabase as CleanupClient
  }
  const nowIso = now.toISOString()
  const result: CleanupResult = { scanned: 0, filesRemoved: 0, projectsCleaned: 0, errors: [] }

  const { data: rows, error } = await client
    .from('projects')
    .select('id, original_file_path, processed_file_path')
    .lt('delete_files_at', nowIso)
    .is('files_deleted_at', null)

  if (error) {
    result.errors.push(`query: ${error.message}`)
    return result
  }
  if (!rows || rows.length === 0) return result

  result.scanned = rows.length

  for (const row of rows) {
    const paths = projectStoragePaths(row)

    if (paths.length > 0) {
      const { error: rmErr } = await client.storage.from(BUCKET).remove(paths)
      if (rmErr) {
        // Leave files_deleted_at null so the next run retries this project.
        result.errors.push(`remove ${row.id}: ${rmErr.message}`)
        continue
      }
      result.filesRemoved += paths.length
    }

    const { error: updErr } = await client
      .from('projects')
      .update({ files_deleted_at: nowIso })
      .eq('id', row.id)
    if (updErr) {
      result.errors.push(`stamp ${row.id}: ${updErr.message}`)
      continue
    }
    result.projectsCleaned += 1
  }

  return result
}
