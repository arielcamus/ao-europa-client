import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installFakeServer } from '../../../tools/party-guild-fake-server.mjs';
import { ExtrasClientPacketId as X, ExtrasServerPacketId as XS } from '../../../packages/protocol/src/index.js';
import { readForm } from './form-reference.js';

// Events, duels, battleground lobbies, the invasion bar and the right-click interaction menu, against the scripted stand-in of the party and
// guild spec (tools/party-guild-fake-server.mjs): it logs "TGuild" in with a second player, "Aotesta", two tiles to the east.
async function login(page: Page) {
  const fake = await installFakeServer(page, { role: 'none' });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  return fake;
}
const say = async (page: Page, text: string) => {
  await page.keyboard.press('Enter');
  await page.locator('#chat').fill(text);
  await page.keyboard.press('Enter');
};
const only = (received: { id: number }[], id: number) => received.filter(p => p.id === id);

test.describe('events, duels and the interaction menu', () => {
  test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'desktop-chrome', 'desktop layout'); });

  test('slash commands write the VB6 packets and answer with the VB6 console lines', async ({ page }) => {
    const fake = await login(page);
    await say(page, '/EVENTO');
    await expect.poll(() => only(fake.received, X.EventoInfo).length).toBe(1);
    await say(page, '/APOSTAR 250');
    await expect.poll(() => only(fake.received, X.Gamble)).toEqual([{ id: X.Gamble, amount: 250 }]);
    await say(page, '/APOSTAR');
    await expect(page.locator('#messages')).toContainText('Faltan parámetros');
    await say(page, '/OFERTAINICIAL 0');
    await expect(page.locator('#messages')).toContainText('Cantidad incorrecta. Utilice /OFERTAINICIAL CANTIDAD.');
    await say(page, '/DESC hola');
    await expect.poll(() => only(fake.received, X.ChangeDescription)).toEqual([{ id: X.ChangeDescription, description: 'hola' }]);
    await say(page, '/PARTICIPAR');
    await expect.poll(() => only(fake.received, X.Participar)).toEqual([{ id: X.Participar, roomId: -1, password: '' }]);
    await say(page, '/CANCELAR');
    await expect.poll(() => only(fake.received, X.CancelDuel).length).toBe(1);
  });

  test('/RETAR opens the duel form, validates it like frmRetos and sends WriteDuel', async ({ page }) => {
    const fake = await login(page);
    await say(page, '/RETAR Aotesta');
    const win = page.locator('#duel-window');
    await expect(win).toBeVisible();
    await expect(page.locator('#duel-player-0')).toHaveValue('TGuild');
    await expect(page.locator('#duel-player-1')).toHaveValue('Aotesta');
    // Repeated names are refused with the VB6 caption; nothing is sent.
    await page.locator('#duel-player-1').fill('TGuild');
    await page.locator('#duel-send').click();
    await expect(page.locator('#duel-error')).toHaveText('No se permiten jugadores repetidos');
    await page.locator('#duel-player-1').fill('B2b');
    await page.locator('#duel-send').click();
    await expect(page.locator('#duel-error')).toHaveText("Nombre del jugador inválido: 'B2b'");
    expect(only(fake.received, X.Duel)).toEqual([]);
    await page.locator('#duel-player-1').fill('Aotesta');
    await page.locator('#duel-bet').fill('5000');
    await page.locator('#duel-red-potions').check();
    await page.locator('#duel-potions').fill('20');
    await page.locator('#duel-drop-items').check();
    await page.locator('#duel-send').click();
    await expect(win).toHaveCount(0);
    await expect.poll(() => only(fake.received, X.Duel)).toEqual([{ id: X.Duel, players: 'Aotesta', bet: 5000, redPotions: 20, dropItems: true }]);
    // Escape closes the form through the window stack.
    await say(page, '/RETAR');
    await expect(win).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(win).toHaveCount(0);
  });

  test('frmRetos: ventanaretos.bmp, every control where the pinned .frm puts it, the Image states and the checkboxes', async ({ page }) => {
    await login(page);
    await say(page, '/RETAR');
    const win = page.locator('#duel-window');
    await expect(win).toBeVisible();
    await expect(win).toHaveCSS('background-image', /ventanaretos\.bmp/);
    await expect(page.locator('#duel-field-0')).toHaveCSS('background-image', /campo-retar\.bmp/);
    // Seven players per side would need txtPPT > 5: txtPPT_Change clamps to MAX_JUGADORES, and every Jugador / Campo pair shows.
    await page.locator('#duel-per-team').fill('9');
    await expect(page.locator('#duel-per-team')).toHaveValue('5');
    await page.locator('#duel-red-potions').check();
    await expect(page.locator('#duel-red-potions')).toHaveCSS('background-image', /check-amarillo\.bmp/);
    await expect(page.locator('#duel-potions')).toHaveValue('10000');
    await expect(page.locator('#duel-bet')).toHaveValue('20000');
    const pairs: [string, string][] = [['txtPPT', 'per-team'], ['Apuesta', 'bet'], ['txtPociones', 'potions'], ['CAMPO_CORTO', 'short-field'], ['Image1', 'red-potions'],
      ['Image2', 'drop-items'], ['Cerrar', 'close'], ['SumarJugadores', 'plus'], ['RestarJugadores', 'minus'], ['Retar', 'send'], ['Error', 'error']];
    for (let i = 0; i < 10; i++) pairs.push([`Jugador-${i}`, `player-${i}`], [`Campo-${i}`, `field-${i}`]);
    const measured = await win.evaluate((root: HTMLElement, list) => {
      const frame = root.getBoundingClientRect(), scale = frame.width / root.offsetWidth, out: Record<string, number[]> = {};
      for (const [control, id] of list) { const r = document.getElementById(`duel-${id}`)!.getBoundingClientRect(); out[control] = [(r.x - frame.x) / scale, (r.y - frame.y) / scale, r.width / scale, r.height / scale]; }
      return { out, size: [root.offsetWidth, root.offsetHeight] };
    }, pairs);
    expect(measured.size).toEqual([291, 487]); // ClientWidth 4365 x ClientHeight 7305 twips
    const { rectangles } = await readForm('frmRetos.frm');
    for (const [control] of pairs) {
      const source = rectangles[control]!, actual = measured.out[control]!;
      expect(source, `form has ${control}`).toBeDefined();
      // Twips / 15 rounded to whole pixels: at most 0.67 px off.
      ['x', 'y', 'width', 'height'].forEach((field, i) => expect(Math.abs(actual[i]! - source[field as 'x']), `${control}.${field}`).toBeLessThan(0.7));
    }
    // SumarJugadores_MouseUp: the count goes up and (as in the VB6 code) RestarJugadores is the one left showing its -over picture.
    await page.locator('#duel-per-team').fill('1');
    await page.locator('#duel-plus').click();
    await expect(page.locator('#duel-per-team')).toHaveValue('2');
    await expect(page.locator('#duel-minus')).toHaveCSS('background-image', /boton-sm-menos-over\.bmp/);
    // Form_MouseMove clears every Image picture again.
    const frame = (await win.boundingBox())!;
    await page.mouse.move(frame.x + 10, frame.y + 200);
    await expect(page.locator('#duel-minus')).toHaveCSS('background-image', 'none');
    await expect(page.locator('#duel-player-4')).toBeHidden();
    await win.screenshot({ path: 'artifacts/screenshots/window-sweep-duel-web.png' });
  });

  test('right click on a player opens the player menu; RETAR fills the duel form, INVITAR GRUPO sends the group skill', async ({ page }) => {
    const fake = await login(page);
    const view = (await page.locator('#viewport').boundingBox())!;
    // Aotesta stands two tiles east of the player, who is in the middle of the 736x608 view.
    const k = view.width / 736;
    const at = { x: view.x + (368 + 64) * k, y: view.y + 304 * k };
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const menu = page.locator('#interaction-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['COMERCIAR', 'INVITAR GRUPO', 'PRIVADO', 'RETAR', 'DENUNCIAR']);
    // MenuUser.frm: 1950 x 1800 twips, black, one 360-twip OpcionImg row per option, OpcionLbl Tahoma 8.25 bold white.
    const shape = await menu.evaluate((el: HTMLElement) => { const k = el.getBoundingClientRect().width / el.offsetWidth; const rows = [...el.children].map(row => row.getBoundingClientRect());
      return { w: el.offsetWidth, h: el.offsetHeight, rows: rows.map(r => Math.round((r.y - rows[0]!.y) / k)), color: getComputedStyle(el).backgroundColor, font: getComputedStyle(el.children[0]!).font }; });
    expect(shape).toMatchObject({ w: 130, h: 120, rows: [0, 24, 48, 72, 96], color: 'rgb(0, 0, 0)' });
    expect(shape.font).toMatch(/^700 11px/);
    // ShowInteractionMenu first writes LeftClick on the tile so the server describes the player.
    await expect.poll(() => only(fake.received, 95).length).toBeGreaterThan(0);
    await menu.getByRole('menuitem', { name: 'RETAR' }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('#duel-player-1')).toHaveValue('Aotesta');
    await page.keyboard.press('Escape');
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'PRIVADO' }).click();
    await expect(page.locator('#chat')).toHaveValue('\\Aotesta ');
    await page.keyboard.press('Escape');
    // Escape closes the menu too.
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // INVITAR GRUPO sends the group skill as WorkLeftClick with the session's counter.
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: 'INVITAR GRUPO' }).click();
    await expect.poll(() => only(fake.received, 2)).toMatchObject([{ id: 2, skill: 90, x: 58, y: 43 }]);
    // Empty ground has no menu.
    await page.mouse.click(view.x + (368 - 96) * k, view.y + 304 * k, { button: 'right' });
    await expect(menu).toHaveCount(0);
  });

  test('battleground lobby list, join with a password, and the invasion bar', async ({ page }) => {
    const fake = await login(page);
    fake.send({ id: XS.ReportLobbyList, lobbies: [
      { id: 7, description: 'Capture', scenarioType: 'CTF', minLevel: 10, maxLevel: 47, minPlayers: 2, maxPlayers: 8, registeredPlayers: 3, teamSize: 4, teamType: 1, inscriptionPrice: 500, isPrivate: 1 },
      { id: 9, description: 'Death', scenarioType: 'DM', minLevel: 1, maxLevel: 47, minPlayers: 2, maxPlayers: 4, registeredPlayers: 0, teamSize: 1, teamType: 0, inscriptionPrice: 0, isPrivate: 0 },
    ] });
    const lobby = page.locator('#lobby-window');
    await expect(lobby).toBeVisible();
    await expect(page.locator('#lobby-list .vb-row')).toHaveCount(2);
    await expect(page.locator('#lobby-list .vb-row').first()).toContainText('Capture · CTF · Nv 10-47 · 3/8');
    await page.locator('#lobby-list .vb-row').first().click();
    await page.locator('#lobby-password').fill('clave');
    await page.locator('#lobby-join').click();
    await expect(lobby).toHaveCount(0);
    await expect.poll(() => only(fake.received, X.Participar)).toEqual([{ id: X.Participar, roomId: 7, password: 'clave' }]);
    // InvasionInfo draws the bar for 10 s (frmMain.Evento): the life bar is 3.5 px per percent.
    const bar = page.locator('#invasion-bar');
    await expect(bar).toBeHidden();
    fake.send({ id: XS.InvasionInfo, invasion: 1, lifePercent: 80, timePercent: 50 });
    await expect(bar).toBeVisible();
    expect(await page.locator('#invasion-life').evaluate(node => (node as HTMLElement).style.width)).toBe('280px');
    // The premium shop is not part of the classic client: one console line and no window.
    fake.send({ id: XS.ShopInit, credits: 100, items: [{ objNum: 1, value: 10, name: 'x' }] });
    await expect(page.locator('#messages')).toContainText('La tienda premium no está disponible en este cliente.');
  });
});
