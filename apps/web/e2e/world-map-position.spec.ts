import { test, expect } from '@playwright/test';
import { FrameDecoder, ServerPacketId as S, decodeServerPacket, encodeServerFrame } from '../../../packages/protocol/src/index.js';
import type { ServerPacket } from '../../../packages/protocol/src/index.js';

// Ariel, 21 Nov: "I'm in the dungeon newbie. The minimap looks good, but the big map shows me in the wrong place." CalcularPosicionMAPA
// finds UserMap in mapsworlddata.dat: map 167 (Dungeon Newbie Sur) is cell 240 of world 2, column 11 row 12, and ActualizarPosicion puts
// Shape1 at x * 27 + UserPos.x * 27 / 100 - 2. The stand-in logs in on map 1; the test warps the session to 167 (50,93) the way the
// server does (ChangeMap, then the player's own CharacterCreate at the new tile), then opens the big map from the minimap.
test('the large map: the player in the Newbie Dungeon is on the dungeon world, in cell 240', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  let inject: (() => void) | undefined;
  type Create = Extract<ServerPacket, { id: S.CharacterCreate }>;
  let self: Create | undefined;
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer(); const frames = new FrameDecoder();
    inject = () => { for (const packet of [{ id: S.ChangeMap, map: 167, resourceMap: 167 }, { ...self!, x: 50, y: 93 }] as ServerPacket[]) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => server.send(message)); ws.onClose(() => server.close());
    server.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      for (const body of frames.push(new Uint8Array(raw))) { const p = decodeServerPacket(body); if (!('unknown' in p) && p.id === S.CharacterCreate && !self) self = p as Create; }
      ws.send(message);
    });
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  inject!();
  await expect(page.locator('#minimap')).toHaveAttribute('data-minimap-map', '167');
  await page.locator('#minimap').click();
  const win = page.locator('#world-map-window');
  await expect(win).toBeVisible();
  await expect(win.locator('.wm-title')).toHaveAttribute('data-map', '167');
  await expect(win.getByRole('button', { name: 'Mapa de mazmorras' })).toHaveAttribute('data-checked', 'true');
  await expect.poll(() => win.locator('.wm-picture').evaluate(el => (el as HTMLElement).style.backgroundImage)).toMatch(/mapa2\.bmp|blob:/);
  const box = (cls: string) => win.locator(cls).evaluate(el => { const s = (el as HTMLElement).style; return { display: s.display, left: parseFloat(s.left), top: parseFloat(s.top) }; });
  // lblAllies on the cell corner, Shape1 inside it.
  expect(await box('.wm-selected')).toEqual({ display: 'block', left: 11 * 27, top: 12 * 27 });
  const player = await box('.wm-player');
  expect(player.display).toBe('block');
  expect(player.left).toBeCloseTo(11 * 27 + 50 * 27 / 100 - 2, 3);
  expect(player.top).toBeCloseTo(12 * 27 + 93 * 27 / 100 - 2, 3);
  // The marker colours are the .frm ones: Shape1 red, lblAllies dark red.
  expect(await win.locator('.wm-player').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)');
  expect(await win.locator('.wm-selected').evaluate(el => getComputedStyle(el).borderTopColor)).toBe('rgb(192, 0, 0)');
  // Unticking Dungeons shows world 1, where map 167 has no cell: Shape1 hides (ActualizarPosicionMapa), as in VB6.
  await win.getByRole('button', { name: 'Mapa de mazmorras' }).click();
  await expect.poll(async () => (await box('.wm-player')).display).toBe('none');
  await page.screenshot({ path: 'artifacts/screenshots/worldmap-newbie-e2e.png' }).catch(() => {});
  expect(failures).toEqual([]);
});
