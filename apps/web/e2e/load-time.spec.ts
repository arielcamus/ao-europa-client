import { test, expect } from '@playwright/test';

// Issue #79: first load on a slow link (1.6 Mbit/s down, 150 ms, the boot-sequence profile). Records every response through CDP
// (bytes on the wire per file), the time the login is usable and the time the first world frame is drawn.
// LOAD_TAG=before|after writes artifacts/load-<tag>.json with the per-file table.
type Row = { url: string; type: string; start: number; end: number; bytes: number; status: number; fromCache: boolean };

async function throttled(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  const t0 = Date.now();
  const rows = new Map<string, Row>();
  cdp.on('Network.requestWillBeSent', e => { rows.set(e.requestId, { url: e.request.url, type: e.type ?? '', start: Date.now() - t0, end: -1, bytes: 0, status: 0, fromCache: false }); });
  cdp.on('Network.responseReceived', e => { const r = rows.get(e.requestId); if (r) { r.status = e.response.status; r.fromCache = !!e.response.fromDiskCache || !!e.response.fromServiceWorker; } });
  cdp.on('Network.loadingFinished', e => { const r = rows.get(e.requestId); if (r) { r.end = Date.now() - t0; r.bytes = e.encodedDataLength; } });
  return { cdp, t0, rows };
}

const kind = (url: string) => {
  const path = new URL(url).pathname;
  if (path.startsWith('/ao-assets/')) return path.slice(11).split('/')[0]!.toLowerCase();
  if (path.startsWith('/bridge')) return 'ws';
  return 'app';
};
function summary(rows: Row[], until: number) {
  const done = rows.filter(r => r.end >= 0 && r.end <= until && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  const byKind: Record<string, { files: number; bytes: number }> = {};
  for (const r of done) { const k = kind(r.url); byKind[k] ??= { files: 0, bytes: 0 }; byKind[k]!.files++; byKind[k]!.bytes += r.bytes; }
  return { files: done.length, bytes: done.reduce((n, r) => n + r.bytes, 0), byKind };
}

async function visit(page: import('@playwright/test').Page, context: import('@playwright/test').BrowserContext) {
  const { t0, rows } = await throttled(page, context);
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#connect')).toBeEnabled({ timeout: 120_000 });
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#connect-stage')).toHaveAttribute('data-screen', 'login');
  const loginReady = Date.now() - t0;
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true', { timeout: 120_000 });
  await expect(page.locator('#classic')).toHaveClass(/in-world/);
  const inWorld = Date.now() - t0;
  return { loginReady, inWorld, rows: [...rows.values()] };
}

// Targets from #79: login usable in < 20 s and the first complete world frame in < 45 s on the first visit, with no think time
// between them (the stand-in enters the world on the first click; a player typing a password only gives the background loads more room).
test('load: login and first world frame on 1.6 Mbit/s, first and second visit', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'throttling via CDP');
  test.setTimeout(300_000);
  const cold = await visit(page, context);
  await page.waitForTimeout(3000);
  const report = {
    loginReady: cold.loginReady, inWorld: cold.inWorld,
    beforeLogin: summary(cold.rows, cold.loginReady), beforeWorld: summary(cold.rows, cold.inWorld), total: summary(cold.rows, Infinity),
    files: cold.rows.filter(r => !r.url.startsWith('data:') && !r.url.startsWith('blob:')).sort((a, b) => b.bytes - a.bytes)
      .map(r => ({ path: new URL(r.url).pathname, bytes: r.bytes, start: r.start, end: r.end, status: r.status, phase: r.end < 0 ? 'pending' : r.end <= cold.loginReady ? 'login' : r.end <= cold.inWorld ? 'world' : 'after' })),
  };
  // Second visit: same browser cache. Every asset URL is pinned to the asset version and immutable, so nothing is downloaded again.
  const again = await context.newPage();
  const warm = await visit(again, context);
  const fetched = (rows: Row[]) => rows.filter(r => kind(r.url) !== 'app' && kind(r.url) !== 'ws' && r.end >= 0 && r.status === 200 && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  const firstTime = new Set(fetched(cold.rows).map(r => r.url));
  const warmAssets = fetched(warm.rows).filter(r => !r.fromCache && firstTime.has(r.url));
  const result = { loginReady: cold.loginReady, inWorld: cold.inWorld, warmLogin: warm.loginReady, warmWorld: warm.inWorld, warmDownloads: warmAssets.map(r => new URL(r.url).pathname), beforeLogin: report.beforeLogin, beforeWorld: report.beforeWorld };
  console.log('LOAD TIMES', JSON.stringify(result));
  const tag = process.env.LOAD_TAG;
  if (tag) { const { mkdirSync, writeFileSync } = await import('node:fs'); mkdirSync('artifacts', { recursive: true }); writeFileSync(`artifacts/load-${tag}.json`, JSON.stringify({ ...report, warm: { loginReady: warm.loginReady, inWorld: warm.inWorld, downloads: result.warmDownloads } }, null, 1)); }
  expect(cold.loginReady, 'login usable on the first visit (ms)').toBeLessThan(20_000);
  expect(cold.inWorld, 'first complete world frame on the first visit (ms)').toBeLessThan(45_000);
  expect(warmAssets.map(r => new URL(r.url).pathname), 'assets downloaded again on the second visit').toEqual([]);
  expect(warm.loginReady, 'login usable on the second visit (ms)').toBeLessThan(8_000);
});
