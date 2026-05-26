import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT || 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'serve-root',
      testMatch: /(app|filters)\.spec\.js$/,
      use: { baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'http-server-dist',
      testMatch: /http-server-dist\.spec\.js$/,
      use: { baseURL: `http://127.0.0.1:${PORT + 1}` },
    },
    {
      name: 'http-server-root',
      testMatch: /http-server-root\.spec\.js$/,
      use: { baseURL: `http://127.0.0.1:${PORT + 2}` },
    },
  ],
  webServer: [
    {
      command: `python3 serve-root.py ${PORT}`,
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `python3 -m http.server ${PORT + 1}`,
      cwd: 'dist',
      port: PORT + 1,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: `python3 -m http.server ${PORT + 2}`,
      port: PORT + 2,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
