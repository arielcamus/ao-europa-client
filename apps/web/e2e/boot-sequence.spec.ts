import { test, expect } from '@playwright/test';

// Boot order of the pinned VB6 client: the loading splash (Frmcarga / VentanaCargando) while resources load, then frmConnect with its
// background and the FrmLogear box, and the frmMain HUD only after entering the world. Run on a throttled network (Ariel plays over the tailnet).
// BOOT_SHOT_TAG=before|after writes artifacts/screenshots/boot-<tag>-<n>-<phase>.png and a timeline to artifacts/boot-<tag>.json.
type Sample = { t: number; hud: boolean; loginBox: boolean; loginBackdrop: boolean; splash: boolean; stage: string | null; statusLine: boolean };
const observer = () => {
  const samples: Sample[] = [];
  (window as unknown as { __boot: Sample[] }).__boot = samples;
  const visible = (el: Element | null) => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && r.width > 0 && r.height > 0; };
  // A picture counts as there only when the browser holds all of it: a still-downloading CSS background paints band by band.
  const downloaded = (css: string) => { const m = /url\("?([^")]+)"?\)/.exec(css); if (!m) return false; const probe = new Image(); probe.src = m[1]!; return probe.complete && probe.naturalWidth > 0; };
  const tick = () => {
    const classic = document.getElementById('classic'), stage = document.getElementById('connect-stage');
    const hudArt = document.querySelector('.main-art');
    const inWorld = !!classic?.classList.contains('in-world');
    samples.push({
      t: Math.round(performance.now()),
      hud: !inWorld && (visible(hudArt) || visible(document.getElementById('inventory-panel')) || visible(document.getElementById('stats-panel')) || visible(document.getElementById('console'))),
      loginBox: visible(document.getElementById('login')),
      loginBackdrop: visible(stage) && stage?.dataset.screen === 'login' && document.querySelectorAll('#connect-stage .cs-login .cs-grh').length >= 3
        && [...document.querySelectorAll<HTMLElement>('#connect-stage .cs-login .cs-grh')].every(g => downloaded(g.style.backgroundImage)) && downloaded(getComputedStyle(stage!).backgroundImage),
      splash: visible(document.getElementById('loading-card')),
      stage: stage && visible(stage) ? stage.dataset.screen ?? null : null,
      statusLine: visible(document.getElementById('connection')) || visible(document.getElementById('scope-note')),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

test('boot: splash, then login with its background, no HUD before the world (slow network)', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'throttling via CDP');
  test.setTimeout(180_000);
  const tag = process.env.BOOT_SHOT_TAG;
  await page.route('**/ao-config.json', route => route.fulfill({ json: { mode: 'classic', serverProfile: 'classic', wsPath: '/bridge' } }));
  await page.addInitScript(observer);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  // 1.6 Mbit/s down, 750 kbit/s up, 150 ms: the usual "slow 4G / fast 3G" profile.
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
  const start = Date.now();
  await page.goto('/', { waitUntil: 'commit' });
  const shots: { n: number; at: number; phase: string }[] = [];
  const phaseNow = () => page.evaluate(() => {
    const s = (window as unknown as { __boot?: Sample[] }).__boot?.at(-1);
    return !s ? 'blank' : s.loginBox ? 'login' : s.splash ? 'splash' : s.hud ? 'hud-bare' : s.stage ? `stage-${s.stage}` : 'blank';
  }).catch(() => 'navigating');
  let n = 0, done = false;
  while (!done && Date.now() - start < 150_000) {
    const phase = await phaseNow();
    if (tag) { await page.screenshot({ path: `artifacts/screenshots/boot-${tag}-${String(n).padStart(2, '0')}-${phase}.png` }); shots.push({ n, at: Date.now() - start, phase }); n++; }
    done = await page.locator('#classic').getAttribute('data-ui-ready').then(v => v === 'true', () => false) && await page.locator('#connect-stage').getAttribute('data-screen').then(v => v === 'login', () => false);
    if (!done) await page.waitForTimeout(tag ? 400 : 250);
  }
  await expect(page.locator('#connect')).toBeEnabled({ timeout: 60_000 });
  await page.waitForTimeout(500);
  if (tag) await page.screenshot({ path: `artifacts/screenshots/boot-${tag}-final-login.png` });
  await page.waitForTimeout(4000);
  if (tag) await page.screenshot({ path: `artifacts/screenshots/boot-${tag}-final-login-plus4s.png` });
  const samples = await page.evaluate(() => (window as unknown as { __boot: Sample[] }).__boot);
  const first = (pred: (s: Sample) => boolean) => samples.find(pred)?.t ?? null;
  const timeline = {
    firstSplash: first(s => s.splash), firstHudBeforeWorld: first(s => s.hud), firstLoginBox: first(s => s.loginBox), firstLoginBackdrop: first(s => s.loginBackdrop),
    firstStatusLine: first(s => s.statusLine), loginReadyWall: Date.now() - start, shots,
  };
  console.log('BOOT TIMELINE', JSON.stringify(timeline));
  if (tag) { const { mkdirSync, writeFileSync } = await import('node:fs'); mkdirSync('artifacts', { recursive: true }); writeFileSync(`artifacts/boot-${tag}.json`, JSON.stringify({ timeline, samples: samples.length }, null, 1)); }
  expect(samples.filter(s => s.hud), 'the frmMain HUD is visible before entering the world').toEqual([]);
  expect(samples.filter(s => s.loginBox && !s.loginBackdrop), 'the login box renders without its background').toEqual([]);
  expect(samples.filter(s => s.statusLine), 'the dev status line is visible').toEqual([]);
  expect(timeline.firstSplash, 'the loading splash shows while resources load').not.toBeNull();
  expect(timeline.firstSplash!).toBeLessThan(timeline.firstLoginBox ?? Infinity);
});

// A picture that is missing, or whose download never completes, must not hold the boot: the login appears anyway (late art paints later).
const cases: [string, string, 'abort404' | 'hang'][] = [
  ['backdrop 239 404', '**/ao-assets/Graficos/239.png', 'abort404'],
  ['backdrop 239 never completes', '**/ao-assets/Graficos/239.png', 'hang'],
  ['splash art 404', '**/ao-assets/interface/*VentanaCargando.bmp', 'abort404'],
  ['splash art never completes', '**/ao-assets/interface/*VentanaCargando.bmp', 'hang'],
];
for (const [name, pattern, mode] of cases) {
  test(`boot: ${name}, login still appears and never shows the HUD`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'single browser is enough');
    await page.route('**/ao-config.json', route => route.fulfill({ json: { mode: 'classic', serverProfile: 'classic', wsPath: '/bridge' } }));
    await page.route(pattern, route => mode === 'abort404' ? route.fulfill({ status: 404, body: '' }) : new Promise(() => { /* never answered */ }));
    await page.addInitScript(observer);
    const start = Date.now();
    await page.goto('/', { waitUntil: 'commit' }); // a hung preload would hold the load event
    await expect(page.locator('#login')).toBeVisible({ timeout: 25_000 });
    expect(Date.now() - start).toBeLessThan(25_000);
    const samples = await page.evaluate(() => (window as unknown as { __boot: Sample[] }).__boot);
    expect(samples.filter(s => s.hud)).toEqual([]);
  });
}

test('boot: a failed resource load (renderer init) ends on the login with the error line, never the HUD', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'single browser is enough');
  await page.route('**/ao-config.json', route => route.fulfill({ json: { mode: 'classic', serverProfile: 'classic', wsPath: '/bridge' } }));
  await page.route('**/ao-assets/Dat/Obj.dat', route => route.fulfill({ status: 500, body: '' }));
  await page.addInitScript(observer);
  await page.goto('/');
  await expect(page.locator('#login')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('alert')).not.toBeEmpty();
  const samples = await page.evaluate(() => (window as unknown as { __boot: Sample[] }).__boot);
  expect(samples.filter(s => s.hud)).toEqual([]);
});
