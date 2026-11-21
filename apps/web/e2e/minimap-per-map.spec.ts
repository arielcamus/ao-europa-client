import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// The default minimap is the per-map picture (ModMinimap.DibujarMiniMapa, CenteredMinimap = 0): the whole 100 x 100 picture of the map,
// sharp at any classic scale / devicePixelRatio, the player dot on the pixel frmMain.SetMinimapPosition gives for the tile.
const vb6Dot = (x: number, y: number) => ({ left: Math.round((x - 13) * (100 / 74) - 3), top: Math.round((y - 10) * (100 / 80) - 3) });

async function enter(page: Page) {
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#minimap')).toHaveAttribute('data-minimap-mode', 'map');
  await expect(page.locator('#minimap-map')).toBeVisible();
}
const tile = async (page: Page) => (await page.locator('#position').textContent())!.split(',').map(Number) as [number, number];
const dot = (page: Page) => page.locator('#minimap-dot').evaluate(el => ({ left: parseFloat((el as HTMLElement).style.left), top: parseFloat((el as HTMLElement).style.top) }));

/**
 * Compares the minimap canvas with the map's BMP decoded at 100 x 100: every picture pixel must fill a uniform k x k block (nearest
 * neighbour) of exactly the BMP's colour, except the pixels DibujarMiniMapa paints the quest markers on. Returns the counts.
 */
const compare = (page: Page) => page.evaluate(async () => {
  const sheet = document.getElementById('minimap-map') as HTMLCanvasElement, k = Number(sheet.dataset.density);
  const map = document.getElementById('minimap')!.dataset.minimapMap;
  const image = new Image(); image.src = `/ao-assets/Minimapas/mapa${map}.bmp`; await image.decode();
  const ref = document.createElement('canvas'); ref.width = 100; ref.height = 100;
  const rc = ref.getContext('2d')!; rc.drawImage(image, 0, 0); const want = rc.getImageData(0, 0, 100, 100).data;
  const got = sheet.getContext('2d')!.getImageData(0, 0, sheet.width, sheet.height).data;
  let same = 0, differ = 0, mixed = 0;
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
    const at = (px: number, py: number) => ((py * sheet.width) + px) * 4;
    const first = at(x * k, y * k);
    let uniform = true;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const p = at(x * k + dx, y * k + dy); for (let c = 0; c < 3; c++) if (got[p + c] !== got[first + c]) uniform = false; }
    if (!uniform) mixed++;
    const w = (y * 100 + x) * 4;
    if (got[first] === want[w] && got[first + 1] === want[w + 1] && got[first + 2] === want[w + 2]) same++; else differ++;
  }
  return { k, width: sheet.width, same, differ, mixed };
});

test('per-map minimap: whole picture at 1:1, dot on the VB6 pixel, moving as the character walks', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  await page.setViewportSize({ width: 1024, height: 768 });
  await enter(page);
  const box = (await page.locator('#minimap').boundingBox())!;
  expect([box.width, box.height]).toEqual([100, 100]);
  await expect.poll(async () => (await compare(page)).same).toBeGreaterThan(8000);
  const result = await compare(page);
  // The whole 100 x 100 BMP, pixel for pixel; only the quest markers (12 pixels each, at most 100 markers) differ.
  expect(result).toMatchObject({ k: 1, width: 100, mixed: 0 });
  expect(result.same + result.differ).toBe(10_000);
  const [x, y] = await tile(page);
  expect(await dot(page)).toEqual(vb6Dot(x, y));
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await tile(page))[0]).toBe(x + 1);
  const moved = await tile(page);
  await expect.poll(() => dot(page)).toEqual(vb6Dot(moved[0], moved[1]));
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/minimap-per-map-1x.png', clip: { x: box.x, y: box.y, width: 100, height: 100 } });
});

test.describe('per-map minimap on a high-density screen', () => {
  test.use({ deviceScaleFactor: 2 });
  test('fills whole k x k device-pixel blocks, nearest neighbour, at classic scale 1.3 x devicePixelRatio 2', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
    await page.setViewportSize({ width: 1440, height: 1000 }); // classicScale 1.30 (see classic-layout.ts), x 2 = 2.6 -> 3 device pixels per pixel
    await enter(page);
    await expect.poll(async () => (await compare(page)).same).toBeGreaterThan(8000);
    const result = await compare(page);
    expect(result).toMatchObject({ k: 3, width: 300, mixed: 0 });
    // The centred (continuous) mode is still one click away in Opciones and hides the per-map canvas.
    await page.evaluate(() => { localStorage.setItem('ao.options.v1', JSON.stringify({ centeredMinimap: true })); });
    await page.reload();
    await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
    await page.locator('#connect').click();
    await expect(page.locator('#minimap')).toHaveAttribute('data-minimap-mode', 'centered');
    await expect(page.locator('#minimap-map')).toBeHidden();
  });
});
