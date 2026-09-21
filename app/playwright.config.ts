import { defineConfig } from '@playwright/test';
import { WEB_PORT as PORT } from './e2e/helpers';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // System Chrome, so no browser download is needed locally.
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
