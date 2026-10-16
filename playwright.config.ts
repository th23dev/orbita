import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  timeout: 60000,
  use: { baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'firefox',
      testMatch: 'stream.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], channel: process.env.PLAYWRIGHT_CHANNEL || undefined },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
      },
})
