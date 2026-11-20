import { defineConfig } from '@playwright/test';

// AO_WEB_PORT lets parallel worktrees run the suite without colliding on 5188.
const port = Number(process.env.AO_WEB_PORT ?? 5188);

export default defineConfig({
  testDir: './apps/web/e2e', timeout: 60_000, workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'retain-on-failure', actionTimeout: 10_000 },
  projects: [
    { name: 'desktop-chrome', use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile-chrome', use: { browserName: 'chromium', channel: 'chrome', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    { name: 'mobile-webkit', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: 'node tools/dev-web.mjs --standin --preview', port, reuseExistingServer: false,
    env: { AO_WEB_PORT: String(port) }, timeout: 15_000,
  },
});
