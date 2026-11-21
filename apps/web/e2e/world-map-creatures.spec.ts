import { test, expect } from '@playwright/test';

// frmMapaGrande creature panel (WP-A): ListView1 + stat labels + animated PlayerView from the map file's NPC section, plus the search caption.
test('the large map lists the creatures of the searched map and previews the selected one', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.locator('#minimap').click();
  const win = page.locator('#world-map-window');
  await expect(win).toBeVisible();
  await win.locator('input').fill('1'); await page.keyboard.press('Enter');
  // cmdSearch_Click writes "name (n)" with a space, unlike a click on the picture ("name(n)").
  await expect(win.locator('.wm-title')).toHaveText(/ \(1\)$/);
  const rows = win.locator('.vb-list').first().locator('.vb-row');
  await expect.poll(() => rows.count()).toBeGreaterThan(5);
  await rows.first().click();
  const preview = win.locator('canvas').first();
  await expect.poll(() => preview.evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let drawn = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) drawn++; return drawn; })).toBeGreaterThan(1000);
  // Escape closes the window (and the animation timer with it).
  await page.keyboard.press('Escape');
  await expect(win).toBeHidden();
  expect(failures).toEqual([]);
});

// #84 review against the pinned frmMapaGrande: Image3_Click's `If Dungeon Then Exit Sub` never fires (nothing assigns Dungeon), so the
// references check also works on the dungeon world; cmdSearch and picMap_MouseDown only rewrite lblMapInfo(0), never Label1.
test('the large map: references toggle on the dungeon world, Label1 kept on search', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.locator('#minimap').click();
  const win = page.locator('#world-map-window');
  await expect(win).toBeVisible();
  const description = await win.locator('.wm-info').textContent();
  await win.getByRole('button', { name: 'Mapa de mazmorras' }).click();
  await expect(win.getByRole('button', { name: 'Mapa de mazmorras' })).toHaveAttribute('data-checked', 'true');
  await win.getByRole('button', { name: 'Referencias del mapa' }).click();
  await expect(win.getByRole('button', { name: 'Referencias del mapa' })).toHaveAttribute('data-checked', 'true');
  await win.locator('input').fill('1'); await page.keyboard.press('Enter');
  await expect(win.locator('.wm-title')).toHaveText(/ \(1\)$/);
  await expect(win.locator('.wm-info')).toHaveText(description ?? '');
  expect(failures).toEqual([]);
});
