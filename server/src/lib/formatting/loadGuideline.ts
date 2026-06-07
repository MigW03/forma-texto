/**
 * Loads a guideline's deterministic formatting values from its canonical spec
 * file (`specs/{id}.md`) — the single source of truth.
 *
 * Flow: read the `.md` → extract the fenced ```jsonc machine block (§8) →
 * parse with JSON5 (tolerates comments + trailing commas) → validate with zod →
 * project the rich spec shape onto the `GuidelineSpec` the pipeline consumes.
 *
 * The result is cached per file mtime: edit the `.md`, the next formatting job
 * picks up the change instantly — no rebuild, no restart. A malformed edit is
 * caught by the schema (and by `loadGuideline.test.ts`) before it reaches a job.
 */
import fs from 'fs'
import path from 'path'
import JSON5 from 'json5'
import { z } from 'zod'
import type { Guideline, GuidelineSpec } from './guidelines'

const SPEC_DIR = path.join(__dirname, 'specs')

const alignSchema = z.enum(['both', 'left'])

/** Dropdown metadata: universal name + per-locale description. */
const displaySchema = z.object({
  name: z.string(),
  description: z.record(z.string(), z.string()),
})

/** Shape of the §8 machine block. Unknown keys are ignored (zod strips them). */
const machineSchema = z.object({
  id: z.string(),
  display: displaySchema,
  fonts: z.object({
    accepted: z.array(z.string()).min(1),
    default: z.string(),
  }),
  page: z.object({
    marginsTwips: z.object({
      top: z.number(),
      bottom: z.number(),
      left: z.number(),
      right: z.number(),
    }),
  }),
  body: z.object({
    sizeHalfPt: z.number(),
    lineTwentieths: z.number(),
    firstLineIndentTwips: z.number(),
    align: alignSchema,
  }),
  headings: z.object({
    sizeHalfPt: z.number(),
    levels: z.record(z.string(), z.object({ bold: z.boolean() })),
  }),
  references: z.object({
    entryAlign: alignSchema,
    entryLineTwentieths: z.number(),
    betweenEntries: z.string(),
    hangingIndent: z.union([z.boolean(), z.number()]),
  }),
})

type Machine = z.infer<typeof machineSchema>

/** Project the rich spec onto the subset the deterministic passes consume. */
function toSpec(m: Machine): GuidelineSpec {
  // One font throughout (§2): body and headings share the single chosen family.
  const font = m.fonts.default
  const hangingIndent =
    typeof m.references.hangingIndent === 'number'
      ? m.references.hangingIndent
      : m.references.hangingIndent
        ? 720
        : 0
  // `entryAfter` is the trailing space (twentieths) that renders the blank line
  // between entries; only applies when the guideline separates entries that way.
  const entryAfter =
    m.references.betweenEntries === 'blank-line' ? m.references.entryLineTwentieths : 0
  return {
    body: {
      font,
      sz: m.body.sizeHalfPt,
      line: m.body.lineTwentieths,
      firstLine: m.body.firstLineIndentTwips,
      align: m.body.align,
    },
    heading: { font, sz: m.headings.sizeHalfPt, bold: m.headings.levels['1']?.bold ?? true },
    margins: m.page.marginsTwips,
    references: {
      entryAlign: m.references.entryAlign,
      entryLine: m.references.entryLineTwentieths,
      entryAfter,
      hangingIndent,
    },
  }
}

/** Pull the §8 ```jsonc fenced block out of the spec markdown. */
function extractMachineBlock(md: string, id: string): string {
  const m = md.match(/```jsonc\s*([\s\S]*?)```/)
  if (!m) throw new Error(`spec "${id}.md" has no \`\`\`jsonc machine block`)
  return m[1]
}

interface CacheEntry {
  mtimeMs: number
  spec: GuidelineSpec
}
const cache = new Map<Guideline, CacheEntry>()

/**
 * Returns the `GuidelineSpec` parsed from `specs/{id}.md`.
 * Throws if the file is missing or the machine block fails validation —
 * callers decide whether to fall back.
 */
export function loadGuidelineFromSpec(id: Guideline): GuidelineSpec {
  const file = path.join(SPEC_DIR, `${id}.md`)
  const { mtimeMs } = fs.statSync(file)
  const cached = cache.get(id)
  if (cached && cached.mtimeMs === mtimeMs) return cached.spec

  const md = fs.readFileSync(file, 'utf8')
  const raw = JSON5.parse(extractMachineBlock(md, id))
  const machine = machineSchema.parse(raw)
  const spec = toSpec(machine)

  cache.set(id, { mtimeMs, spec })
  return spec
}

/** Dropdown entry for one guideline. `id` is the spec filename (= lookup key). */
export interface GuidelineMeta {
  id: string
  name: string
  description: Record<string, string>
}

/** Parse just the `display` metadata from one spec file. */
function loadGuidelineMeta(id: string): GuidelineMeta {
  const md = fs.readFileSync(path.join(SPEC_DIR, `${id}.md`), 'utf8')
  const { display } = machineSchema.parse(JSON5.parse(extractMachineBlock(md, id)))
  return { id, name: display.name, description: display.description }
}

/**
 * Enumerate every guideline that ships a spec file. This is what populates the
 * project-creation dropdown — drop a new `{id}.md` into `specs/` and it appears
 * here automatically. A spec that fails to parse is skipped (logged), never
 * breaking the list for the others.
 */
export function listGuidelines(): GuidelineMeta[] {
  return fs
    .readdirSync(SPEC_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.basename(f, '.md'))
    .flatMap(id => {
      try {
        return [loadGuidelineMeta(id)]
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn(`[guidelines] skipping "${id}.md" in list: ${(err as Error).message}`)
        }
        return []
      }
    })
}
