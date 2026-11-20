import { defineConfig } from '@playwright/test';

// Opt-in integration test. Start the actual server and local bridge first.
// Disable traces: a login trace could contain the supplied password.
export default defineConfig({
  testDir: './apps/web/e2e', testMatch: 'real-server.live.ts',
  timeout: 75_000, workers: 1,
  use: {
    baseURL: process.env.AO_REAL_SERVER_URL ?? 'http://127.0.0.1:5191',
    browserName: 'chromium', channel: 'chrome', trace: 'off',
    viewport: { width: 1440, height: 1000 }, actionTimeout: 10_000,
  },
});
