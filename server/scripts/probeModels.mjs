// Throwaway reliability probe: run the REAL assembled Step C prompt against several
// free OpenRouter models, a few times each, and report whether the JSON parsed, which
// backend provider served it, and how many entries got emphasis. Finds a free model
// that returns clean structured output reliably. Run from server/: node scripts/probeModels.mjs
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FMT = path.join(__dirname, '..', 'src', 'lib', 'formatting')
const apiKey = process.env.OPENROUTER_API_KEY
const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
if (!apiKey) { console.error('OPENROUTER_API_KEY missing'); process.exit(1) }

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
const system = [instructions, ``, `Guideline rules (authoritative):`, guidelineSection(abnt, 6), ``, `Reference examples (authoritative templates):`, guidelineSection(abnt, 7)].join('\n')

const refs = [
  'ABNT. ABNT NBR 16175. [S. l.]: [s. d.], 2013.',
  'BACK, N. Projeto integrado de produtos: planejamento, concepção e modelagem. Barueri: Manole, 2008.',
  'BARNES, D. K. A. et al. Accumulation and fragmentation of plastic debris in global environments. Philosophical Transcations of the Royal Society, [s. l.], 2009. Disponível em: https://x.com. Acesso em: 9 abr. 2025.',
  'BONIN, S. J.; DEMARCO, A. L.; SIEGMUND, G. P. The Effect of MIPS on Headform Kinematics. Annals of Biomedical Engineering, [s. l.], v. 50, n. 7, p. 860–870, 2022. Disponível em: https://doi.org/x. Acesso em: 30 nov. 2025.',
  'BRESSAN, F. Design e tecnologia : estratégias generativas. [s. l.], 2018. Disponível em: https://lume.ufrgs.br/x. Acesso em: 16 nov. 2025.',
]
const user = `Reformat these reference entries. Return one decision per entry.\n\n` + refs.map((t, i) => `{ "i": ${i}, "text": ${JSON.stringify(t)} }`).join('\n')

const MODELS = [
  process.env.AI_MODEL ?? 'google/gemini-2.0-flash-exp:free',
]
const RUNS = 2

async function one(model) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(30000), // never hang — fail after 30s
  })
  const data = await res.json()
  const provider = data.provider ?? '?'
  if (!res.ok) return { ok: false, provider, note: `http ${res.status} ${data.error?.message ?? ''}`.slice(0, 60) }
  const content = data.choices?.[0]?.message?.content ?? ''
  try {
    const parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, '').trim())
    const decs = parsed.decisions ?? []
    const emph = decs.filter(d => (d.segments ?? []).some(s => s.emphasis)).length
    return { ok: true, provider, note: `parsed ${decs.length} decisions, ${emph}/${decs.length} with emphasis` }
  } catch (e) {
    return { ok: false, provider, note: `PARSE FAIL: ${String(e.message).slice(0, 50)}` }
  }
}

for (const model of MODELS) {
  console.log(`\n=== ${model} ===`)
  for (let r = 0; r < RUNS; r++) {
    try { const x = await one(model); console.log(`  run ${r + 1}: ${x.ok ? 'OK ' : 'XX '} [${x.provider}] ${x.note}`) }
    catch (e) { console.log(`  run ${r + 1}: ERR ${String(e.message).slice(0, 60)}`) }
  }
}
