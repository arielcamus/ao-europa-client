import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { DoorClientPacketId, FrameDecoder, decodeClientPacket } from '../../../packages/protocol/src/index.js';

// The classic window fills a large monitor. Clicks must land on the same controls at 1x, 1.5x and 2x.
for (const [name, width, height, scale] of [['1x', 1024, 768, 1], ['1.5x', 1536, 1152, 1.5], ['2x', 2048, 1536, 2]] as const) {
  test(`classic window at ${name}: layout fills the screen and clicks hit the right controls`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'desktop scaling only; phones keep their own layout');
    await page.setViewportSize({ width, height });
    // Every LeftClick the page sends (tile x, y): the tap on the map below must name the tile that was tapped.
    const leftClicks: { x: number; y: number }[] = [];
    page.on('websocket', socket => {
      const framing = new FrameDecoder();
      socket.on('framesent', ({ payload }) => {
        for (const body of framing.push(Buffer.from(payload))) {
          const packet = decodeClientPacket(body);
          if (!('unknown' in packet) && packet.id === DoorClientPacketId.LeftClick) leftClicks.push({ x: packet.x, y: packet.y });
        }
      });
    });
    // The default minimap is the per-map picture mode (see options-settings.ts); this test drives the continuous one.
    await page.addInitScript(() => { try { localStorage.setItem('ao.options.v1', JSON.stringify({ centeredMinimap: true })); } catch { /* no storage */ } });
    await page.goto('/');
    await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
    await page.locator('#connect').click();
    await expect(page.locator('#connection')).toHaveText('Connected');
    await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
    const frame = (await page.locator('#classic').boundingBox())!;
    expect(frame.width).toBeCloseTo(1024 * scale, 1);
    expect(frame.height).toBeCloseTo(768 * scale, 1);
    // Centred, crisp.
    expect(frame.x).toBeCloseTo((width - frame.width) / 2, 0);
    expect(await page.locator('#viewport canvas').evaluate(c => getComputedStyle(c).imageRendering)).toBe('pixelated');
    // Inventory slot: select slot 1 then slot 2, by real mouse position.
    const slot = (n: number) => page.getByRole('button', { name: new RegExp(`^Casilla ${n}:`) });
    await slot(1).click();
    await expect(slot(1)).toHaveAttribute('aria-pressed', 'true');
    await slot(2).click();
    await expect(slot(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(slot(1)).toHaveAttribute('aria-pressed', 'false');
    // Buttons: tabs and the stats/menu switch.
    await page.getByRole('tab', { name: 'Hechizos', exact: true }).click();
    await expect(page.locator('#spells')).toBeVisible();
    await page.getByRole('tab', { name: 'Inventario', exact: true }).click();
    await expect(page.locator('#inventory')).toBeVisible();
    await page.getByRole('button', { name: 'Menú', exact: true }).click();
    await expect(page.locator('#hp-text')).toBeHidden();
    await page.getByRole('button', { name: 'Stats', exact: true }).click();
    await expect(page.locator('#hp-text')).toBeVisible();
    // Map tiles: a click one tile east of the character (real mouse) must not be read as another tile.
    const view = (await page.locator('#viewport').boundingBox())!;
    const tile = 32 * scale;
    const [px, py] = (await page.locator('#position').innerText()).split(', ').map(Number) as [number, number];
    await page.mouse.click(view.x + view.width / 2 + tile, view.y + view.height / 2);
    await expect(page.locator('#connection')).toHaveText('Connected');
    await expect.poll(() => leftClicks.length).toBeGreaterThan(0);
    expect(leftClicks.at(-1)).toEqual({ x: px + 1, y: py });
    // The minimap: the centred DirectX mode (VB6 default, switched on here) (a 100 x 100 canvas in the 100 px control), the player dot is its centre, and the
    // zoom buttons change the crop (CenteredMinimapZoom -20 / +20, clamped to +-50).
    const minimap = page.locator('#minimap');
    await expect(minimap).toHaveAttribute('data-minimap-mode', 'centered');
    const box = (await minimap.boundingBox())!;
    expect(box.width).toBeCloseTo(100 * scale, 1); expect(box.height).toBeCloseTo(100 * scale, 1);
    await expect(page.locator('#minimap-canvas')).toBeVisible();
    expect(await page.locator('#minimap-canvas').evaluate((c: HTMLCanvasElement) => [c.width, c.height])).toEqual([100, 100]);
    const zoom = () => page.evaluate(() => JSON.parse(localStorage.getItem('ao.options.v1') ?? '{}').centeredMinimapZoom ?? 0);
    await page.locator('#minimap-zoom-in').click(); await expect.poll(zoom).toBe(-20);
    await page.locator('#minimap-zoom-out').click(); await page.locator('#minimap-zoom-out').click(); await page.locator('#minimap-zoom-out').click(); await page.locator('#minimap-zoom-out').click();
    await expect.poll(zoom).toBe(50);
    await page.locator('#minimap-zoom-in').click(); await page.locator('#minimap-zoom-in').click(); await page.locator('#minimap-zoom-in').click(); await page.locator('#minimap-zoom-in').click(); await page.locator('#minimap-zoom-in').click(); await page.locator('#minimap-zoom-in').click(); await expect.poll(zoom).toBe(-50);
    await mkdir('artifacts/screenshots', { recursive: true });
    await page.screenshot({ path: `artifacts/screenshots/screen-minimap-${name}.png` });
  });
}

// Ariel, 21 Nov: "Many items in the GUI look pixeled/blurry". A MacBook window (1512x982 at DPR 2) is 2.56 device pixels per art pixel.
// Fill: every piece of art nearest neighbour (frmMain art buttons and window backgrounds were smooth-filtered), the world canvas rendered at
// the on-screen device pixels (it was 1472 px wide, stretched again to 1882 by the CSS scale) and the window starting on a whole device pixel.
// Whole: 2 device px per art px, letterboxed.
for (const [mode, scale] of [['fill', 982 / 768], ['whole', 1]] as const) {
  test(`Retina window, ?scale=${mode}: crisp art and a canvas at device pixels`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'desktop scaling only');
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await page.goto(`/?scale=${mode}`);
      await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
      await page.locator('#connect').click();
      await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
      const frame = (await page.locator('#classic').boundingBox())!;
      expect(frame.width).toBeCloseTo(1024 * scale, 1);
      expect((frame.x * 2) % 1).toBeCloseTo(0, 5); expect((frame.y * 2) % 1).toBeCloseTo(0, 5);
      await expect(page.locator('#classic')).toHaveAttribute('data-crisp', 'true');
      expect(await page.locator('#classic').evaluate(e => getComputedStyle(e).imageRendering)).toBe('pixelated');
      // frmMain's art buttons and the options window draw their art as CSS backgrounds.
      expect(await page.locator('#minimap-zoom-in').evaluate(e => [getComputedStyle(e).backgroundImage !== 'none', getComputedStyle(e).imageRendering])).toEqual([true, 'pixelated']);
      await page.locator('#settings').click();
      await expect(page.locator('#options')).toBeVisible();
      expect(await page.locator('#options').evaluate(e => getComputedStyle(e).imageRendering)).toBe('pixelated');
      const canvas = await page.locator('#viewport canvas').evaluate((c: HTMLCanvasElement) => ({ backing: [c.width, c.height], shown: c.getBoundingClientRect().width * devicePixelRatio }));
      expect(canvas.backing).toEqual([Math.round(736 * scale * 2), Math.round(608 * scale * 2)]);
      expect(Math.abs(canvas.backing[0]! - canvas.shown)).toBeLessThan(1);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ao.options.v1') ?? '{}').screenScale)).toBe(mode);
      await mkdir('artifacts/screenshots', { recursive: true });
      await page.screenshot({ path: `artifacts/screenshots/gui-sharpness-retina-${mode}.png` });
    } finally { await context.close(); }
  });
}
