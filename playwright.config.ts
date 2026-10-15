import { defineConfig, devices } from '@playwright/test'

// Screens are checked at the two widths the design was drawn at: 1440 for the
// desktop artboards and 402 for the iPhone frames. Vitest only collects from
// core, modules, integrations and scripts, so nothing here is picked up twice.

process.loadEnvFile('.env')

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // 90 rather than 30 seconds. The tests themselves take two to four seconds;
  // what takes the rest is Turbopack compiling a route the first time it is
  // visited, and with thirteen modules that outran a 30 second budget on two
  // specs in a full run while both passed in isolation. A dev server compiling
  // is not a failing screen.
  timeout: 90_000,

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /\.setup\.ts/ },
    {
      name: 'desktop',
      dependencies: ['setup'],
      testIgnore: /\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: 'e2e/.auth/owner.json',
      },
    },
    {
      name: 'mobile',
      dependencies: ['setup'],
      testIgnore: /\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 402, height: 874 },
        isMobile: false,
        // Touch on, so the gesture specs can dispatch a real touch pointer.
        // isMobile stays off: it changes the viewport meta and the device
        // scale factor, and every screenshot in this project was taken
        // without it.
        hasTouch: true,
        storageState: 'e2e/.auth/owner.json',
      },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
