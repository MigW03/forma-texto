// Print the EXACT system + user prompt the Step C pipeline sends, assembled the same
// way ai/referencesPrompt.ts builds it. Run from server/: node scripts/dumpPrompt.mjs
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FMT = path.join(__dirname, '..', 'src', 'lib', 'formatting')

const promptBody = md => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
function guidelineSection(md, n) {
  const lines = md.split(/\r?\n/)
  const start = lines.findIndex(l => new RegExp(`^##\\s+${n}\\.`).test(l))
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) { if (/^##\s+/.test(lines[i])) { end = i; break } }
  return lines.slice(start, end).join('\n').trim()
}

const instructions = promptBody(fs.readFileSync(path.join(FMT, 'prompts', 'reference-reformatting.md'), 'utf8')).replace(/\{\{GUIDELINE\}\}/g, 'ABNT')
const abnt = fs.readFileSync(path.join(FMT, 'specs', 'abnt.md'), 'utf8')
const system = [instructions, ``, `Guideline rules (authoritative):`, guidelineSection(abnt, 6) || '(no rules section provided)', ``, `Reference examples (authoritative templates):`, guidelineSection(abnt, 7) || '(no examples section provided)'].join('\n')

const refs = [
  'BACK, N. Projeto integrado de produtos: planejamento, concepção e modelagem. Barueri: Manole, 2008.',
  'BARNES, D. K. A. et al. Accumulation and fragmentation of plastic debris in global environments. Philosophical Transcations of the Royal Society, [s. l.], 2009. Acesso em: 9 abr. 2025.',
]
const user = `Reformat these reference entries. Return one decision per entry.\n\n` + refs.map((t, i) => `{ "i": ${i}, "text": ${JSON.stringify(t)} }`).join('\n')

const out = `==================== SYSTEM PROMPT ====================\n\n${system}\n\n==================== USER PROMPT ====================\n\n${user}\n\n==================== (also: generateObject sends the zod schema as a structured-output tool) ====================\n`
fs.writeFileSync(path.join(__dirname, 'assembled-prompt.txt'), out)
console.log(`system chars: ${system.length}, user chars: ${user.length} -> wrote scripts/assembled-prompt.txt`)
