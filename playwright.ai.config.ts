import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /AIInferenceOverlaySmoke\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: './tests/test-results-ai',
  reporter: [['html', { outputFolder: './tests/playwright-report-ai' }]],
  globalTimeout: 900_000,
  timeout: 240_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'on-first-retry',
    testIdAttribute: 'data-cy',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
  ],
  webServer: {
    command: 'yarn dev:orthanc',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 360_000,
  },
});
