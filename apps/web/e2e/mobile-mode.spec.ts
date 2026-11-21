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

test('portrait phone: zoomed world, joystick, drawer, classic HUD hidden', async ({ page }) => {
  await mkdir('artifacts/screenshots', { recursive: true });
  await enterWorld(page);
  expect(await page.locator('#mobile-world #viewport').count()).toBe(1);
  await expect(page.locator('#inventory-panel')).toBeHidden();
  // About 11 tiles across a 390 px phone: 736 px of world (23 tiles) drawn ~2.2x wider than the screen... per tile ~35 px.
  const world = (await page.locator('#viewport').boundingBox())!;
  const tile = world.width / 23;
  expect(tile).toBeGreaterThan((390 / 11) * 0.85);
  expect(tile).toBeLessThan((390 / 11) * 1.15);
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
  // Cover: no black margins, about 10-11 tiles high.
  const world = (await page.locator('#viewport').boundingBox())!;
  expect(world.width).toBeGreaterThanOrEqual(843);
  expect(390 / (world.width / 23)).toBeLessThan(11.5);
  await page.screenshot({ path: 'artifacts/screenshots/mobile-mode-landscape.png' });
});
