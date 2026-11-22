// AGPL-3.0-or-later. Mobile mode fit check against the REAL VB6 server (22 Nov: on Ariel's iPhone the controls were off-screen).
// Logs in on emulated phones (WebKit iPhones with Safari's bars, a small Chromium Android), portrait and landscape, and checks
// that every control is inside the visible area, nothing overlaps, the console wraps and the page cannot scroll; then a desktop
// page to show the classic layout is unchanged. Usage:
//   AO_WEB_PORT=5848 AO_EMAIL=.. AO_PASSWORD=.. node tools/mobile-mode-fit-shot.mjs [deviceName...]
// Writes artifacts/screenshots/mobile-fit-<device>.png and mobile-fit-desktop.png; exits 1 when a check fails.
import { chromium, devices, webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5848}/`;
const out = 'artifacts/screenshots';
mkdirSync(out, { recursive: true });
const names = process.argv.slice(2).length ? process.argv.slice(2)
  : ['iPhone 13', 'iPhone 13 landscape', 'iPhone 14', 'iPhone 14 landscape', 'Galaxy S9+', 'Galaxy S9+ landscape'];
const engines = { webkit: () => webkit.launch(), chromium: () => chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch()) };
const failures = [];
const slug = name => name.toLowerCase().replace(/\W+/g, '-');

/** In the page: every visible control's box against the visible area and against the other controls. */
function measure() {
  const W = innerWidth, H = innerHeight, problems = [];
  const box = node => { const r = node.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const visible = node => { const s = getComputedStyle(node); const r = node.getBoundingClientRect(); return !node.closest('[hidden]') && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const controls = ['#mobile-top .m-who', '#mobile-top .m-where', '#m-chat', '#m-zoom', '#m-menu', '#mobile-bars .m-hp', '#mobile-bars .m-mana', '#mobile-bars .m-sta', '#mobile-joystick', '#mobile-joystick .m-joy-hint', '#m-act', '#m-drawer-btn', '#m-potion-hp', '#m-potion-mana', '#m-meditate', '#m-pickup', '#mobile-console']
    .map(selector => [selector, document.querySelector(selector)]).filter(([, node]) => node && visible(node));
  for (const [selector, node] of controls) {
    const b = box(node);
    if (b.l < -0.5 || b.t < -0.5 || b.r > W + 0.5 || b.b > H + 0.5) problems.push(`${selector} outside ${W}x${H}: ${JSON.stringify(b)}`);
  }
  const buttons = controls.filter(([s]) => /^#m-(act|drawer-btn|potion-hp|potion-mana|meditate|pickup|chat|zoom|menu)$/.test(s));
  for (let i = 0; i < buttons.length; i++) for (let j = i + 1; j < buttons.length; j++) {
    const a = box(buttons[i][1]), b = box(buttons[j][1]);
    if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) problems.push(`${buttons[i][0]} overlaps ${buttons[j][0]}`);
  }
  for (const line of document.querySelectorAll('#mobile-console #console > *')) {
    const b = box(line);
    if (b.w > 0 && b.r > W + 0.5) problems.push(`console line runs past the right edge: ${line.textContent?.slice(0, 40)}`);
  }
  // Classic HUD pieces outside #hud must not leak over the mobile world (22 Nov: the delete-item button did).
  for (const node of document.querySelectorAll('#classic > :not(#hud)')) if (visible(node) && !node.classList.contains('visually-hidden') && !node.closest('[role="dialog"], .vb-window, .window')) problems.push(`classic piece visible: #${node.id}.${node.className}`);
  const page = document.scrollingElement;
  if (page.scrollHeight > H + 1 || page.scrollWidth > W + 1) problems.push(`page scrolls: ${page.scrollWidth}x${page.scrollHeight} in ${W}x${H}`);
  const layer = box(document.getElementById('mobile-layer'));
  if (Math.abs(layer.w - W) > 1 || Math.abs(layer.h - H) > 1) problems.push(`layer ${layer.w}x${layer.h} is not the visible ${W}x${H}`);
  const view = box(document.getElementById('viewport')), zoom = Number(document.getElementById('mobile-layer').dataset.zoom);
  return {
    size: `${W}x${H}`, dpr: devicePixelRatio, zoom, tiles: document.getElementById('mobile-layer').dataset.tiles,
    devicePxPerArtPx: +(zoom * devicePixelRatio).toFixed(3), viewportOrigin: [view.l * devicePixelRatio, view.t * devicePixelRatio].map(v => +v.toFixed(2)),
    meta: document.querySelector('meta[name="viewport"]')?.content, problems,
  };
}

const browsers = {};
try {
  for (const name of names) {
    const device = devices[name];
    if (!device) throw new Error(`Unknown device ${name}`);
    const browser = browsers[device.defaultBrowserType] ??= await engines[device.defaultBrowserType]();
    const context = await browser.newContext({ ...device });
    // No layout forced: the touch detection must pick mobile on its own.
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.waitForTimeout(2000);
    await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD'));
    await page.locator('#password').focus(); // the iOS auto-zoom trigger
    await page.locator('#connect').tap();
    await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
    // The previous context's character may still be leaving ("El personaje está saliendo"): pick it again a few times.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.locator('.cs-slot-hit').first().dblclick();
      if (await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 15_000 }).then(() => true, () => false)) break;
    }
    await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 30_000 }).catch(async error => {
      await page.screenshot({ path: `${out}/mobile-fit-${slug(name)}-stuck.png` });
      console.log(name, 'stuck before the world', await page.locator('body').innerText().catch(() => ''));
      throw error;
    });
    await page.locator('#mobile-layer').waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
    const active = await page.evaluate(() => document.documentElement.classList.contains('mobile-world'));
    const result = active ? await page.evaluate(measure) : { problems: ['mobile mode did not activate'] };
    if (errors.length) result.problems.push(...errors.map(e => `page error: ${e}`));
    await page.screenshot({ path: `${out}/mobile-fit-${slug(name)}.png` });
    // The drawer (inventory) must open inside the screen too.
    if (active) {
      await page.locator('#m-drawer-btn').tap(); await page.getByRole('tab', { name: 'Inventario' }).tap(); await page.waitForTimeout(500);
      const drawer = await page.locator('#mobile-drawer').boundingBox(), vp = page.viewportSize();
      if (!drawer || drawer.x < 0 || drawer.y < 0 || drawer.x + drawer.width > vp.width + 0.5 || drawer.y + drawer.height > vp.height + 0.5) result.problems.push(`drawer outside: ${JSON.stringify(drawer)}`);
      await page.screenshot({ path: `${out}/mobile-fit-${slug(name)}-inventory.png` });
    }
    console.log(name, JSON.stringify(result));
    if (result.problems.length) failures.push(name);
    await context.close(); await new Promise(r => setTimeout(r, 6000)); // the server closes the old session before the next login
  }
  // Desktop: classic frmMain, no mobile layer, page meta untouched.
  const browser = browsers.chromium ??= await engines.chromium();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(base); await page.waitForTimeout(2000);
  await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(1200);
  await page.locator('.cs-slot-hit').first().dblclick();
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 90_000 }); await page.waitForTimeout(2500);
  const desktop = await page.evaluate(() => ({ mobile: document.documentElement.classList.contains('mobile-world') || document.documentElement.classList.contains('mobile-mode'), meta: document.querySelector('meta[name="viewport"]')?.content, hudViewport: !!document.querySelector('#hud > #viewport'), layer: getComputedStyle(document.getElementById('mobile-layer')).display }));
  console.log('desktop', JSON.stringify(desktop));
  if (desktop.mobile || !desktop.hudViewport || desktop.layer !== 'none' || desktop.meta !== 'width=device-width, initial-scale=1') failures.push('desktop');
  await page.screenshot({ path: `${out}/mobile-fit-desktop.png` });
  await context.close();
} finally { for (const browser of Object.values(browsers)) await browser.close(); }
if (failures.length) { console.log('FAILED', failures); process.exit(1); }
console.log('all fit checks passed');
