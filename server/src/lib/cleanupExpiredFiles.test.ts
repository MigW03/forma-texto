import { describe, it, expect } from 'vitest'
import {
  cleanupExpiredFiles,
  projectStoragePaths,
  type CleanupClient,
  type ExpiredProjectRow,
} from './cleanupExpiredFiles'

describe('projectStoragePaths', () => {
  it('collects original, processed, and the derived PDF path', () => {
    const paths = projectStoragePaths({
      id: 'p1',
      original_file_path: 'u/p1/original/in.docx',
      processed_file_path: 'u/p1/processed/out.docx',
    })
    expect(paths).toEqual([
      'u/p1/original/in.docx',
      'u/p1/processed/out.docx',
      'u/p1/processed/out.pdf',
    ])
  })

  it('skips null paths and never derives a PDF without a processed file', () => {
    expect(projectStoragePaths({ id: 'p2', original_file_path: 'a.docx', processed_file_path: null })).toEqual([
      'a.docx',
    ])
    expect(projectStoragePaths({ id: 'p3', original_file_path: null, processed_file_path: null })).toEqual([])
  })

  it('dedupes when paths overlap', () => {
    const paths = projectStoragePaths({ id: 'p4', original_file_path: 'same.docx', processed_file_path: 'same.docx' })
    expect(paths).toEqual(['same.docx', 'same.pdf'])
  })
})

/** Build a fake CleanupClient over a fixed set of rows, recording side effects. */
function makeClient(rows: ExpiredProjectRow[], opts: { removeFail?: Set<string>; selectError?: string } = {}) {
  const removed: string[][] = []
  const stamped: string[] = []
  let lastLt: { col: string; val: string } | null = null

  const client: CleanupClient = {
    from() {
      return {
        select() {
          return {
            lt(col: string, val: string) {
              lastLt = { col, val }
              return {
                async is() {
                  if (opts.selectError) return { data: null, error: { message: opts.selectError } }
                  return { data: rows, error: null }
                },
              }
            },
          }
        },
        update() {
          return {
            async eq(_col: string, id: string) {
              stamped.push(id)
              return { error: null }
            },
          }
        },
      }
    },
    storage: {
      from() {
        return {
          async remove(paths: string[]) {
            // Fail if any path belongs to a project flagged to fail.
            const failId = [...(opts.removeFail ?? [])].find((id) => paths.some((p) => p.includes(id)))
            if (failId) return { error: { message: 'storage down' } }
            removed.push(paths)
            return { error: null }
          },
        }
      },
    },
  }

  return { client, removed, stamped, getLastLt: () => lastLt }
}

describe('cleanupExpiredFiles', () => {
  const now = new Date('2026-06-23T12:00:00.000Z')

  it('removes files and stamps each expired project', async () => {
    const rows: ExpiredProjectRow[] = [
      { id: 'a', original_file_path: 'a/in.docx', processed_file_path: 'a/out.docx' },
      { id: 'b', original_file_path: 'b/in.docx', processed_file_path: null },
    ]
    const { client, removed, stamped, getLastLt } = makeClient(rows)

    const r = await cleanupExpiredFiles(client, now)

    expect(r.scanned).toBe(2)
    expect(r.projectsCleaned).toBe(2)
    expect(r.filesRemoved).toBe(3 + 1) // a: docx+pdf+original, b: original
    expect(r.errors).toEqual([])
    expect(stamped).toEqual(['a', 'b'])
    expect(removed).toEqual([['a/in.docx', 'a/out.docx', 'a/out.pdf'], ['b/in.docx']])
    // Query bound on the cutoff time.
    expect(getLastLt()).toEqual({ col: 'delete_files_at', val: now.toISOString() })
  })

  it('returns empty result when nothing is expired', async () => {
    const { client } = makeClient([])
    const r = await cleanupExpiredFiles(client, now)
    expect(r).toEqual({ scanned: 0, filesRemoved: 0, projectsCleaned: 0, errors: [] })
  })

  it('does not stamp a project whose files failed to delete (retried next run)', async () => {
    const rows: ExpiredProjectRow[] = [
      { id: 'good', original_file_path: 'good/in.docx', processed_file_path: null },
      { id: 'bad', original_file_path: 'bad/in.docx', processed_file_path: null },
    ]
    const { client, stamped } = makeClient(rows, { removeFail: new Set(['bad']) })

    const r = await cleanupExpiredFiles(client, now)

    expect(r.projectsCleaned).toBe(1)
    expect(stamped).toEqual(['good'])
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('bad')
  })

  it('stamps a row with no files (nothing to remove) so it is not rescanned', async () => {
    const rows: ExpiredProjectRow[] = [{ id: 'empty', original_file_path: null, processed_file_path: null }]
    const { client, removed, stamped } = makeClient(rows)

    const r = await cleanupExpiredFiles(client, now)

    expect(r.filesRemoved).toBe(0)
    expect(removed).toEqual([]) // remove() never called
    expect(stamped).toEqual(['empty'])
    expect(r.projectsCleaned).toBe(1)
  })

  it('surfaces a query error without throwing', async () => {
    const { client } = makeClient([], { selectError: 'boom' })
    const r = await cleanupExpiredFiles(client, now)
    expect(r.scanned).toBe(0)
    expect(r.errors).toEqual(['query: boom'])
  })
})
