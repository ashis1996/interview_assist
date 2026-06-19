import { describe, it, expect } from 'vitest'
import { runMigrations, schemaPath, type MigrationRunner } from '../db/migrate'
import { readFileSync } from 'node:fs'

// A tiny in-memory Postgres stand-in that models just enough DDL semantics to
// verify idempotency: creating an object that already exists throws "already
// exists" UNLESS the statement guards with IF NOT EXISTS, and seed inserts that
// guard with ON CONFLICT are no-ops on the second run. This means the test only
// passes if `db/schema.sql` is authored to be re-runnable — running migrations
// twice is a genuine no-op.
class FakeIdempotentPg implements MigrationRunner {
  private readonly objects = new Set<string>()
  private readonly columns = new Set<string>()
  private readonly seeded = new Set<string>()

  async query(sql: string): Promise<unknown> {
    for (const raw of FakeIdempotentPg.statements(sql)) {
      this.apply(raw)
    }
    return { rows: [] }
  }

  private apply(stmt: string): void {
    const s = stmt.replace(/\s+/g, ' ').trim()
    if (!s) return

    const createTable = /^CREATE TABLE (IF NOT EXISTS )?(\w+)/i.exec(s)
    if (createTable) {
      const guarded = Boolean(createTable[1])
      this.create(`table:${createTable[2]!.toLowerCase()}`, guarded)
      return
    }

    const createIndex = /^CREATE (?:UNIQUE )?INDEX (IF NOT EXISTS )?(\w+)/i.exec(s)
    if (createIndex) {
      const guarded = Boolean(createIndex[1])
      this.create(`index:${createIndex[2]!.toLowerCase()}`, guarded)
      return
    }

    const addColumn = /^ALTER TABLE (\w+) ADD COLUMN (IF NOT EXISTS )?(\w+)/i.exec(s)
    if (addColumn) {
      const guarded = Boolean(addColumn[2])
      const key = `${addColumn[1]!.toLowerCase()}.${addColumn[3]!.toLowerCase()}`
      if (this.columns.has(key) && !guarded) {
        throw new Error(`column "${key}" already exists`)
      }
      this.columns.add(key)
      return
    }

    const insert = /^INSERT INTO (\w+)/i.exec(s)
    if (insert) {
      const guarded = /ON CONFLICT/i.test(s)
      const key = `seed:${insert[1]!.toLowerCase()}`
      if (this.seeded.has(key) && !guarded) {
        throw new Error(`duplicate key value violates unique constraint on ${insert[1]}`)
      }
      this.seeded.add(key)
      return
    }
    // ENABLE ROW LEVEL SECURITY / REVOKE / etc. are inherently idempotent — ignore.
  }

  private create(key: string, guarded: boolean): void {
    if (this.objects.has(key) && !guarded) {
      throw new Error(`relation "${key}" already exists`)
    }
    this.objects.add(key)
  }

  private static statements(sql: string): string[] {
    return sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

describe('runMigrations', () => {
  it('reads and executes db/schema.sql', async () => {
    const executed: string[] = []
    const pool: MigrationRunner = {
      async query(sql: string) {
        executed.push(sql)
        return undefined
      },
    }

    const sql = await runMigrations(pool)

    expect(executed).toHaveLength(1)
    expect(sql).toBe(readFileSync(schemaPath(), 'utf8'))
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS accounts')
  })

  it('is idempotent: running twice is a no-op', async () => {
    const pool = new FakeIdempotentPg()

    await expect(runMigrations(pool)).resolves.toBeTypeOf('string')
    // Second run must not throw — every creating statement is guarded.
    await expect(runMigrations(pool)).resolves.toBeTypeOf('string')
  })

  // Guarded integration test: only runs when a throwaway Postgres is provided.
  const TEST_DB = process.env['TEST_DATABASE_URL']
  it.runIf(TEST_DB)('is idempotent against a real Postgres', async () => {
    const { Pool } = await import('pg')
    const pool = new Pool({ connectionString: TEST_DB })
    try {
      await runMigrations(pool)
      // Running again converges to the same state without error.
      await runMigrations(pool)
      const { rows } = await pool.query(
        "SELECT count(*)::int AS n FROM accounts WHERE identity_ref = 'dev-account'"
      )
      // Seed is ON CONFLICT DO NOTHING, so exactly one Dev_Account exists.
      expect(rows[0].n).toBe(1)
    } finally {
      await pool.end()
    }
  })
})
