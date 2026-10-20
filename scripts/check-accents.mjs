/**
 * Guard: member identity colours must resolve through CSS variables, never as
 * an inline color function.
 *
 * Why this test exists: `accent` feeds an SVG `stroke` *presentation attribute*.
 * That position accepts a plain colour value or `var(--x)`, but it does NOT
 * accept a CSS function like `color-mix()` — an inline color-mix there makes the
 * member-to-task tether disappear entirely, silently, with no console error.
 * So the mix must live in the stylesheet (where it is a real CSS declaration)
 * and the attribute must only carry `var(--tc-mN)`.
 *
 * Run: node scripts/check-accents.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

const problems = []

// 1. ACCENTS must be var() references, one per hue.
const accentsMatch = source.match(/var ACCENTS = ACCENT_HUES\.map\([^\n]*\n/)
if (!accentsMatch) {
  problems.push('ACCENTS is no longer built from ACCENT_HUES')
} else if (!/var\(--tc-m' \+ i \+ '\)/.test(accentsMatch[0])) {
  problems.push('ACCENTS no longer yields var(--tc-mN) references')
}

// 2. No color function may sit in an object literal feeding a stroke attribute.
//    Look for `stroke:` lines that contain a CSS function.
const strokeLines = source.split('\n')
  .map((line, i) => ({ line, no: i + 1 }))
  .filter(({ line }) => /\bstroke\s*:/.test(line))
for (const { line, no } of strokeLines) {
  if (/color-mix\(|hsl\(|rgb\(|oklch\(/.test(line)) {
    problems.push(`line ${no}: stroke carries a CSS colour function (won't render as a presentation attribute): ${line.trim()}`)
  }
}

// 3. Every --tc-mN the code can reference must be declared in the stylesheet,
//    and the count must match the hue table.
const hues = source.match(/var ACCENT_HUES = \[([^\]]+)\]/)
const hueCount = hues ? hues[1].split(',').filter(s => s.trim() !== '').length : 0
const declared = new Set(
  [...source.matchAll(/--tc-m(\d+):/g)].map(m => Number(m[1])),
)
for (let i = 0; i < hueCount; i += 1) {
  if (!declared.has(i)) problems.push(`--tc-m${i} is referenced by ACCENTS but not declared in CSS`)
}
if (hueCount === 0) problems.push('ACCENT_HUES is empty or unparsable')

// 4. The declaration itself must be a color-mix over the theme accent, i.e. the
//    palette follows the host theme instead of hard-coding hex.
for (const i of declared) {
  const decl = source.match(new RegExp(`--tc-m${i}:([^;']+)`))
  if (!decl) continue
  const value = decl[1]
  if (!/color-mix\(in oklab/.test(value)) {
    problems.push(`--tc-m${i} is not a color-mix() over the theme accent: ${value}`)
  }
  if (!/var\(--tc-accent\)/.test(value)) {
    problems.push(`--tc-m${i} does not derive from var(--tc-accent): ${value}`)
  }
  if (/#[0-9a-fA-F]{3,8}\b/.test(value)) {
    problems.push(`--tc-m${i} still hard-codes a hex colour: ${value}`)
  }
}

// 5. No stray hex palette should survive at module scope.
const accentsArray = source.match(/var ACCENTS = \[[^\]]*\]/)
if (accentsArray && /#[0-9a-fA-F]{3,8}/.test(accentsArray[0])) {
  problems.push('ACCENTS still contains hard-coded hex values')
}

console.log('hues: %d   declared vars: %d   stroke attrs: %d', hueCount, declared.size, strokeLines.length)

if (problems.length > 0) {
  console.error('\nFAIL')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\nOK: identity colours resolve via var(--tc-mN) over the theme accent.')
