import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// .env is loaded here rather than by each suite, so DATABASE_URL can be
// rewritten to the test database before any worker starts.
process.loadEnvFile('.env')

// Derived here rather than imported from scripts/test-db.ts: importing a .ts
// module into the config makes tsc ask for allowImportingTsExtensions and Vite
// warn about a missing extension. Three lines is cheaper than either. The
// setup script derives the same name the same way.
function testDatabaseUrl(url: string): string {
  const parsed = new URL(url)
  parsed.pathname = '/pos_test'
  return parsed.toString()
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['{core,modules,integrations,scripts}/**/*.test.{ts,tsx}'],
    // Several suites read and write the same local Postgres tables. Running the
    // files in parallel makes them race, which showed up as the soft cap test
    // seeing another file's truncate. The whole suite runs in well under a
    // second, so serial costs nothing.
    fileParallelism: false,
    // Rebuilds pos_test from supabase/migrations before anything runs.
    globalSetup: ['./scripts/test-db.ts'],
    env: {
      // Every suite talks to pos_test. The suites delete from core.connections
      // and core.settings, and doing that to the development database wiped the
      // owner's real provider keys once already.
      DATABASE_URL: testDatabaseUrl(process.env.DATABASE_URL ?? 'postgresql://localhost/pos'),
    },
  },
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '.') },
  },
})
