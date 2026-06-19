// Schema migration runner (Req 1.4).
//
// Managed Postgres (Supabase) has no docker-compose init mount, so the schema
// must be applied programmatically. `db/schema.sql` is authored to be fully
// idempotent (CREATE TABLE IF NOT EXISTS, ALTER TABLE ... ADD COLUMN IF NOT
// EXISTS, CREATE INDEX IF NOT EXISTS, seed ON CONFLICT DO NOTHING), so running
// this on every deploy simply converges the schema — running it twice is a
// no-op.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Minimal pool surface needed to apply the schema (the pg `Pool` satisfies this). */
export interface MigrationRunner {
  query(sql: string): Promise<unknown>
}

/** Absolute path to the idempotent schema applied by {@link runMigrations}. */
export function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, 'schema.sql')
}

/**
 * Apply `db/schema.sql` via the provided pool. The schema is idempotent, so
 * this is safe to run on every startup and repeatedly (running twice is a
 * no-op). Returns the SQL that was executed for observability/testing.
 */
export async function runMigrations(pool: MigrationRunner): Promise<string> {
  const sql = readFileSync(schemaPath(), 'utf8')
  await pool.query(sql)
  return sql
}

// `npm run migrate` entry point: connect using DATABASE_URL, apply the schema,
// then close the pool.
async function main(): Promise<void> {
  const { Pool } = await import('pg')
  await import('dotenv/config')
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error('Missing required environment variable: DATABASE_URL')
  }
  const pool = new Pool({ connectionString })
  try {
    await runMigrations(pool)
    // eslint-disable-next-line no-console
    console.log('[migrate] schema applied')
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[migrate] failed', err)
    process.exit(1)
  })
}
