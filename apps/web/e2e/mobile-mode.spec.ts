import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Mobile mode (prototype): the separate touch layout. The other touch tests pin the classic layout (playwright.config.ts).
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-chrome', 'one touch browser is enough for the prototype');
  await page.addInitScript(() => { try { localStorage.setItem('ao.layout', 'mobile'); } catch { /* no storage */ } });
});

async function enterWorld(page: Page) {
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').tap();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#mobile-layer')).toBeVisible();
}
const position = async (page: Page) => (await page.locator('#position').textContent()) ?? '';

/**
 * 22 Nov (Ariel's iPhone): every control inside the visible area, the world under the whole screen, no page scroll, and the
 * overlays taking only their own touches (the world's centre and its edges between the overlays still reach the world).
 */
async function expectFits(page: Page) {
  const fit = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight, out: string[] = [];
    const shown = (n: Element) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n); return !n.closest('[hidden]') && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    for (const n of document.querySelectorAll('#mobile-top .m-who, #m-chat, #m-zoom, #m-menu, #mobile-bars .m-bar, #mobile-joystick, #mobile-actions .m-btn, #mobile-console')) {
      if (!shown(n)) continue;
      const r = n.getBoundingClientRect();
      if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.push(`${n.id || n.className} outside`);
    }
    for (const n of document.querySelectorAll('#mobile-console #console > *')) if (n.getBoundingClientRect().right > W + 0.5) out.push('console line past the edge');
    const page = document.scrollingElement!;
    if (page.scrollHeight > H + 1 || page.scrollWidth > W + 1) out.push('page scrolls');
    const world = document.getElementById('mobile-world')!.getBoundingClientRect();
    if (Math.abs(world.width - W) > 1 || Math.abs(world.height - H) > 1) out.push(`world area ${world.width}x${world.height} is not the screen`);
    // Edge to edge (Ariel, 22 Nov: no black bands): the drawn world covers the whole screen.
    const drawn = document.getElementById('viewport')!.getBoundingClientRect();
    if (drawn.left > 0.5 || drawn.top > 0.5 || drawn.right < W - 0.5 || drawn.bottom < H - 0.5) out.push(`world does not fill the screen: ${drawn.width}x${drawn.height}`);
    const canvas = document.querySelector('#viewport canvas')!.getBoundingClientRect();
    if (canvas.width < drawn.width - 1 || canvas.height < drawn.height - 1) out.push('the canvas did not follow the larger view');
    const joy = document.getElementById('mobile-joystick')!.getBoundingClientRect();
    const at = (x: number, y: number) => document.elementFromPoint(x, y);
    if (!at(joy.left + joy.width / 2, joy.top + joy.height / 2)?.closest('#mobile-joystick')) out.push('joystick does not get its touches');
    if (!at(W / 2, H / 2)?.closest('#viewport')) out.push('the centre is not the world');
    if (!at(W / 2, H - 20)?.closest('#viewport, #mobile-world')) out.push('the bottom between the overlays is not the world');
    return out;
  });
  expect(fit).toEqual([]);
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('maximum-scale=1');
}

test('portrait phone: zoomed world, joystick, drawer, classic HUD hidden', async ({ page }) => {
  await mkdir('artifacts/screenshots', { recursive: true });
  await enterWorld(page);
  expect(await page.locator('#mobile-world #viewport').count()).toBe(1);
  await expect(page.locator('#inventory-panel')).toBeHidden();
  // At least 11 tiles across a 390 px phone at a crisp scale: 1x at dpr 2 (12.2 tiles).
  const world = (await page.locator('#viewport').boundingBox())!;
  const tile = 32 * Number(await page.locator('#mobile-layer').getAttribute('data-zoom'));
  expect(390 / tile).toBeGreaterThanOrEqual(11);
  expect(390 / tile).toBeLessThan(13);
  await expectFits(page);
  // The player is centred in the world area (above the control deck).
  const area = (await page.locator('#mobile-world').boundingBox())!;
  expect(Math.abs(world.x + world.width / 2 - (area.x + area.width / 2))).toBeLessThan(2);
  expect(Math.abs(world.y + world.height / 2 - (area.y + area.height / 2))).toBeLessThan(2);

  // Joystick: hold to the right and the character walks east.
  const before = await position(page);
  const zone = (await page.locator('#mobile-joystick').boundingBox())!;
  const cx = zone.x + zone.width / 2, cy = zone.y + zone.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 45, cy, { steps: 4 });
  await expect(page.locator('#mobile-joystick .m-joy-base')).toBeVisible();
  await expect.poll(() => position(page), { timeout: 5000 }).not.toBe(before);
  await page.mouse.up();
  await expect(page.locator('#mobile-joystick .m-joy-base')).toBeHidden();
  const [bx] = before.split(',').map(Number), [ax] = (await position(page)).split(',').map(Number);
  expect(ax!).toBeGreaterThan(bx!);

  // The big button without a target is the attack key; it says so.
  await expect(page.locator('#m-act')).toHaveAttribute('data-rule', 'no-target');
  await page.locator('#m-act').tap();
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-portrait.png' });

  // Long-press on the own character: the spell picker (positive spells first), closed by its button.
  const self = (await page.locator('#mobile-world').boundingBox())!;
  await page.mouse.move(self.x + self.width / 2, self.y + self.height / 2 - 10); await page.mouse.down();
  await page.waitForTimeout(700); await page.mouse.up();
  await expect(page.locator('#mobile-picker')).toBeVisible();
  await expect(page.locator('#mobile-picker')).toContainText('Dardo Mágico');
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-picker.png' });
  await page.locator('#mobile-picker .m-close').tap();
  await expect(page.locator('#mobile-picker')).toBeHidden();

  // Drawer: the stand-in's three spells and its inventory.
  await page.locator('#m-drawer-btn').tap();
  await expect(page.locator('#mobile-drawer')).toBeVisible();
  await expect(page.locator('#mobile-drawer .m-spell')).toHaveCount(3);
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-drawer.png' });
  await page.getByRole('tab', { name: 'Inventario' }).tap();
  expect(await page.locator('#mobile-drawer .m-item').count()).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Menú' }).tap();
  await page.getByRole('button', { name: 'Modo clásico' }).tap();
  // Back to classic: the viewport returns to frmMain with its 736x608 geometry, scaled with the whole window.
  await expect(page.locator('#mobile-layer')).toBeHidden();
  expect(await page.locator('#hud > #viewport').count()).toBe(1);
  await expect(page.locator('#inventory-panel')).toBeVisible();
  const classic = (await page.locator('#viewport').boundingBox())!, frame = (await page.locator('#classic').boundingBox())!;
  expect(classic.width / frame.width).toBeCloseTo(736 / 1024, 2);
  await expect(page.locator('#mobile-toggle')).toBeVisible();
  await page.locator('#mobile-toggle').tap();
  await expect(page.locator('#mobile-layer')).toBeVisible();
});

test('landscape phone: the controls float over the world', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await enterWorld(page);
  const area = (await page.locator('#mobile-world').boundingBox())!;
  expect(area.height).toBeCloseTo(390, 0);
  expect(await page.locator('#mobile-deck').evaluate(node => getComputedStyle(node).backgroundImage)).toBe('none');
  // The classic 17x13 range fits: at least 13 tiles high and 17 across.
  const tile = 32 * Number(await page.locator('#mobile-layer').getAttribute('data-zoom'));
  expect(390 / tile).toBeGreaterThanOrEqual(13);
  expect(844 / tile).toBeGreaterThanOrEqual(17);
  await expectFits(page);
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-landscape.png' });
});

test('console: a swipe scrolls back through the history, stays visible and keeps its place when a line arrives', async ({ page }) => {
  await enterWorld(page);
  // Enough history to scroll: extra rows in the console's list, as classic-ui renders them.
  await page.evaluate(() => {
    const list = document.getElementById('messages')!;
    for (let i = 0; i < 40; i++) { const row = document.createElement('div'); row.textContent = `línea de prueba ${i}`; list.append(row); }
    const node = document.getElementById('console')!; node.scrollTop = node.scrollHeight;
  });
  const box = (await page.locator('#console').boundingBox())!;
  const before = { top: await page.locator('#console').evaluate(n => n.scrollTop), position: await position(page) };
  expect(await page.locator('#console').evaluate(n => { const s = getComputedStyle(n); return [s.overflowY, s.touchAction, s.overscrollBehaviorY]; })).toEqual(['auto', 'pan-y', 'contain']);
  // A real touch swipe (downwards = back in time), through the browser's gesture pipeline.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.synthesizeScrollGesture', { x: box.x + box.width / 2, y: box.y + box.height / 2, yDistance: 120, gestureSourceType: 'touch', speed: 800 });
  await expect.poll(() => page.locator('#console').evaluate(n => n.scrollTop)).toBeLessThan(before.top - 20);
  await expect(page.locator('#mobile-console')).toHaveClass(/back/);
  expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
  expect(await position(page)).toBe(before.position); // the swipe never walked or tapped the world
  // A new line (classic-ui re-renders and jumps to the bottom): the reader keeps their place.
  const kept = await page.locator('#console').evaluate(n => n.scrollTop);
  await page.evaluate(() => { const list = document.getElementById('messages')!; const row = document.createElement('div'); row.textContent = 'nueva'; list.append(row); const n = document.getElementById('console')!; n.scrollTop = n.scrollHeight; });
  await expect.poll(() => page.locator('#console').evaluate(n => n.scrollTop)).toBe(kept);
  // Scrolled back it does not fade.
  await page.waitForTimeout(7000);
  expect(await page.locator('#mobile-console').evaluate(n => getComputedStyle(n).opacity)).toBe('1');
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-console-back.png' });
  // Back at the bottom: normal again (fades after a few seconds).
  await page.locator('#console').evaluate(n => { n.scrollTop = n.scrollHeight; });
  await expect(page.locator('#mobile-console')).not.toHaveClass(/back/);
});

test('classic windows open inside the screen in both orientations, close button reachable (22 Nov: the NPC box ran off the left edge)', async ({ page }) => {
  await enterWorld(page);
  for (const size of [{ width: 390, height: 664 }, { width: 750, height: 342 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(300);
    for (const entry of ['Opciones', 'Mapa']) {
      await page.locator('#m-menu').tap();
      await page.getByRole('tab', { name: 'Menú' }).tap();
      await page.locator('#mobile-drawer').getByRole('button', { name: entry, exact: true }).tap();
      await page.waitForTimeout(600);
      const boxes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#classic > [data-mobile-fit]')].filter(n => !n.hidden && n.offsetWidth)
        .map(n => { const r = n.getBoundingClientRect(); return { id: n.id, l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
      const shown = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#classic > *')].filter(n => !n.hidden && n.offsetWidth && getComputedStyle(n).display !== 'none' && n.id !== 'hud').map(n => `${n.tagName}#${n.id}.${n.className}`));
      expect(boxes.length, `${entry} opened a fitted window; shown: ${shown.join(', ')}`).toBeGreaterThan(0);
      for (const b of boxes) {
        expect(b.l, `${entry} ${b.id} left`).toBeGreaterThanOrEqual(0); expect(b.t, `${entry} ${b.id} top`).toBeGreaterThanOrEqual(0);
        expect(b.r, `${entry} ${b.id} right`).toBeLessThanOrEqual(size.width + 0.5); expect(b.b, `${entry} ${b.id} bottom`).toBeLessThanOrEqual(size.height + 0.5);
      }
      if (size.width === 390 && entry === 'Opciones') await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-window-portrait.png' });
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      await page.evaluate(() => { for (const n of document.querySelectorAll<HTMLElement>('#classic > [data-mobile-fit]')) if (!n.hidden) n.querySelector<HTMLElement>('[aria-label="Cerrar"], .vb-close, button[title="Cerrar"]')?.click(); });
    }
    expect(await page.evaluate(() => [scrollX, scrollY])).toEqual([0, 0]);
  }
});
