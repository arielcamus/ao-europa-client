import { defineConfig } from '@playwright/test';
// Opt-in live check against the real VB6 server; the dev server (tools/dev-web.mjs) must already run on AO_WEB_PORT.
export default defineConfig({
  testDir: '.', testMatch: '*.live.ts', timeout: 5 * 60_000, workers: 1, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5818}`, browserName: 'chromium', channel: 'chrome', viewport: { width: 1024, height: 768 }, actionTimeout: 15_000,
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] } },
});
