/**
 * Copies the formatting data files that tsc does not emit into the build output,
 * so they can be read at runtime under `node dist/...`:
 *   - guideline spec files   (`src/lib/formatting/specs/*.md`)   → read by getGuideline()
 *   - AI prompt files        (`src/lib/formatting/prompts/*.md`) → read by the AI passes
 * tsc only emits `.js`; these `.md` files are data and must be copied verbatim.
 * Runs after `tsc` (see package.json "build").
 */
const fs = require('fs')
const path = require('path')

const base = path.join(__dirname, '..')

for (const dir of ['specs', 'prompts']) {
  const src = path.join(base, 'src', 'lib', 'formatting', dir)
  const dest = path.join(base, 'dist', 'lib', 'formatting', dir)
  fs.mkdirSync(dest, { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log(`[copySpecs] ${src} -> ${dest}`)
}
