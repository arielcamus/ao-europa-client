import { defineConfig } from '@playwright/test';
// WP-D playthrough harness. Opt-in, real VB6 server. Env: AO_SERVER_HOST/AO_SERVER_PORT (default 127.0.0.1:7667), AO_WEB_PORT, AO_BRIDGE_PORT (7797),
// AO_ASSETS (Recursos-prehoo). Run: pnpm playthrough  (see tools/playthrough/README in docs/PLAYTHROUGH.md "Running it").
const webPort = Number(process.env.AO_WEB_PORT ?? 5797);
export default defineConfig({
  testDir: '.', testMatch: 'playthrough.live.ts', timeout: 30 * 60_000, workers: 1, fullyParallel: false, reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${webPort}`, browserName: 'chromium', channel: 'chrome', trace: 'off', viewport: { width: 1024, height: 768 }, actionTimeout: 15_000 },
  webServer: {
    command: 'node tools/dev-web.mjs', cwd: new URL('../../../', import.meta.url).pathname, port: webPort, reuseExistingServer: true, timeout: 60_000,
    env: { AO_WEB_PORT: String(webPort), AO_BRIDGE_PORT: process.env.AO_BRIDGE_PORT ?? '7797', AO_TCP_HOST: process.env.AO_SERVER_HOST ?? '127.0.0.1', AO_TCP_PORT: process.env.AO_SERVER_PORT ?? '7667', AO_ASSETS: process.env.AO_ASSETS ?? '' },
  },
});
