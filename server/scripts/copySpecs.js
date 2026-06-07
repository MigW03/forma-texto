/**
 * Copies guideline spec files (`src/lib/formatting/specs/*.md`) into the build
 * output so `getGuideline()` can read them at runtime under `node dist/...`.
 * tsc only emits `.js`; these `.md` files are data and must be copied verbatim.
 * Runs after `tsc` (see package.json "build").
 */
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', 'src', 'lib', 'formatting', 'specs')
const dest = path.join(__dirname, '..', 'dist', 'lib', 'formatting', 'specs')

fs.mkdirSync(dest, { recursive: true })
fs.cpSync(src, dest, { recursive: true })

console.log(`[copySpecs] ${src} -> ${dest}`)
