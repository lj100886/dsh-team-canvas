/**
 * Guard: the zh and en dictionaries must carry exactly the same keys, and every
 * key the UI actually asks for must exist in both. A missing key renders the raw
 * id, which looks like a bug rather than untranslated text.
 *
 * Run: node scripts/check-locale.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const clientPath = path.join(root, 'client.js')
const source = fs.readFileSync(clientPath, 'utf8')

/** Pull the `var ZH = { ... }` / `var EN = { ... }` literal bodies out of the module. */
function dictBody(name) {
  const marker = `var ${name} = {`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`dictionary ${name} not found in client.js`)
  const from = source.indexOf('{', start)
  let depth = 0
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(from, i + 1)
    }
  }
  throw new Error(`unbalanced braces in dictionary ${name}`)
}

/** Keys declared at the top level of a dictionary literal. */
function keysOf(body) {
  return [...body.matchAll(/^\s{6}([A-Za-z_$][\w$]*):/gm)].map(m => m[1]).sort()
}

const zh = keysOf(dictBody('ZH'))
const en = keysOf(dictBody('EN'))

/** Keys the code asks for via t('...'). */
const used = [...source.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1])
const usedUnique = [...new Set(used)].sort()

const onlyZh = zh.filter(k => !en.includes(k))
const onlyEn = en.filter(k => !zh.includes(k))
const missingZh = usedUnique.filter(k => !zh.includes(k))
const missingEn = usedUnique.filter(k => !en.includes(k))
const unused = zh.filter(k => !usedUnique.includes(k))

const problems = []
if (onlyZh.length > 0) problems.push(`in ZH but not EN: ${onlyZh.join(', ')}`)
if (onlyEn.length > 0) problems.push(`in EN but not ZH: ${onlyEn.join(', ')}`)
if (missingZh.length > 0) problems.push(`used by code but missing from ZH: ${missingZh.join(', ')}`)
if (missingEn.length > 0) problems.push(`used by code but missing from EN: ${missingEn.join(', ')}`)

// The shipped JSON mirrors EN so downstream consumers see the same strings.
const jsonPath = path.join(root, 'locale', 'en.json')
const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))['team-canvas'] ?? {}
const jsonKeys = Object.keys(json).sort()
const onlyJson = jsonKeys.filter(k => !en.includes(k))
const onlyEnVsJson = en.filter(k => !jsonKeys.includes(k))
if (onlyJson.length > 0) problems.push(`in locale/en.json but not EN: ${onlyJson.join(', ')}`)
if (onlyEnVsJson.length > 0) problems.push(`in EN but not locale/en.json: ${onlyEnVsJson.join(', ')}`)

console.log('ZH keys: %d   EN keys: %d   used by code: %d', zh.length, en.length, usedUnique.length)
if (unused.length > 0) console.log('declared but unused (allowed): %s', unused.join(', '))

if (problems.length > 0) {
  console.error('\nFAIL')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log('\nOK: zh/en/en.json are key-identical and cover every key the UI uses.')
