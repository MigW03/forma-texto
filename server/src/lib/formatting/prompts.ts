/**
 * Loader for the AI prompt instruction files (`prompts/{name}.md`).
 *
 * Each file is "skill-like": YAML frontmatter (name/description/output) plus a
 * markdown body of instructions for one AI pass. Externalising the instructions
 * here means the AI's behaviour can be tuned by editing markdown — no code change,
 * no rebuild, no restart (the file is mtime-cached, like the guideline specs).
 *
 * Guideline-SPECIFIC rules still live in `specs/{id}.md` (the single source of
 * truth); these prompt files hold the guideline-agnostic task framing. The pass
 * combines the two: prompt body + the relevant spec section.
 */
import fs from 'fs'
import path from 'path'

const PROMPT_DIR = path.join(__dirname, 'prompts')

const cache = new Map<string, { mtimeMs: number; md: string }>()

/** Raw markdown of a prompt file (frontmatter included), mtime-cached. */
export function loadPrompt(name: string): string {
  const file = path.join(PROMPT_DIR, `${name}.md`)
  const { mtimeMs } = fs.statSync(file)
  const cached = cache.get(name)
  if (cached && cached.mtimeMs === mtimeMs) return cached.md

  const md = fs.readFileSync(file, 'utf8')
  cache.set(name, { mtimeMs, md })
  return md
}

/** Strip leading YAML frontmatter so only the instruction body reaches the model. */
export function promptBody(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
}
