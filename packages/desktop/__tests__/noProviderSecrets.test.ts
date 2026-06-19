// Provider-secret leakage guard (dev-release Task 8.3).
//
// Regression guard for correctness property 5 (No secret leakage): no
// Provider_Secret identifier may ever be referenced in the desktop source
// tree. Provider_Secrets live ONLY on the host backend; the desktop client
// holds only public values (backend/gateway/Supabase URLs + the Supabase
// publishable/anon key) baked as MAIN_VITE_* (Req 2.3, 9.1, 9.2, 9.4).
//
// This walks packages/desktop with fs and fails if any forbidden identifier
// appears in a scanned source file. The needle strings are assembled from
// fragments at runtime so the literal identifiers never appear verbatim in
// this test file (and the __tests__ dir is excluded from the scan anyway), so
// the guard can never trip on its own search terms.
//
// **Validates: Requirements 2.3, 9.1, 9.2, 9.4** (correctness property 5)

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// __tests__ → desktop package root.
const desktopRoot = join(here, '..')

// Directories that are not part of the distributed/authored source and must be
// skipped: dependencies, build outputs, packaging artifacts, this test dir, and
// vite caches.
const SKIP_DIRS = new Set([
  'node_modules',
  'out',
  'dist',
  'build',
  '__tests__',
  '.vite',
  '.git',
])

// File extensions that constitute authored/bundled source we care about.
const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html']

// Forbidden provider-secret identifiers, assembled from fragments so the full
// literals never appear in this file's own text (defensive: the scan also
// excludes __tests__). These are the env-var identifiers / property names that
// would only ever exist if a secret were being held client-side.
const FORBIDDEN: string[] = [
  'DEEPGRAM' + '_API_KEY',
  'GROQ' + '_API_KEY',
  'GEMINI' + '_API_KEY',
  'OPENAI' + '_API_KEY',
  'ANTHROPIC' + '_API_KEY',
  'SUPABASE' + '_SERVICE_ROLE_KEY',
  'service' + '_role',
  'service' + 'Role',
]

function listSourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      found.push(...listSourceFiles(full))
    } else if (SCAN_EXTS.some((ext) => name.endsWith(ext))) {
      found.push(full)
    }
  }
  return found
}

describe('no Provider_Secret leaks into desktop source (Task 8.3, property 5)', () => {
  const files = listSourceFiles(desktopRoot)

  it('scans a non-trivial set of source files', () => {
    // Sanity: the walk actually reached source (guards against a silently
    // empty scan that would make the guard vacuously pass).
    expect(files.length).toBeGreaterThan(5)
  })

  it('contains no forbidden provider-secret identifier in any source file', () => {
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const lower = text.toLowerCase()
      for (const needle of FORBIDDEN) {
        if (lower.includes(needle.toLowerCase())) {
          offenders.push(`${relative(desktopRoot, file)} -> ${needle}`)
        }
      }
    }
    expect(offenders, `Provider_Secret identifiers found in desktop source:\n${offenders.join('\n')}`).toEqual([])
  })
})
