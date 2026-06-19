import { defineConfig } from 'vitest/config'

// Root config so `npx vitest` from the repo root runs every package's tests.
// Each package also has its own vitest.config.ts for isolated runs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/**/*.test.ts', 'packages/*/**/*.test.tsx']
  }
})
