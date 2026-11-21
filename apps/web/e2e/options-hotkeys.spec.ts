import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { FrameDecoder, ServerPacketId as SP, OptionsClientPacketId as OC, OptionsServerPacketId as OS, KeysClientPacketId as KC, HOTKEY_TOGGLE, decodeClientPacket, encodeServerFrame } from '../../../packages/protocol/src/index.js';
import type { ClientPacket, ServerPacket } from '../../../packages/protocol/src/index.js';

// Issue #40: the wp11 UI (options window, key editor, hotkey bar) against the stand-in server. The stand-in knows nothing about hotkeys, so
// the page's WebSocket is intercepted: SendClientToggles ("hotokey-enabled") is injected after login and SetHotkeySlot / UseHKeySlot are
// recorded and swallowed here instead of reaching the stand-in.
// IsBindable is not read from Hechizos.dat: the pinned client takes it from the server's ChangeSpellSlot / ChangeInventorySlot (bindable flag),
// so these tests inject those packets and run on any data set (pre-HOO Recursos included).

/** The spell list is rebuilt on every UI revision, so a row found a moment ago can be detached when its box is read: read it again. */
async function box(locator: import('@playwright/test').Locator) {
  let rect: Awaited<ReturnType<typeof locator.boundingBox>> = null;
  await expect.poll(async () => (rect = await locator.boundingBox()) !== null).toBe(true);
  return rect!;
}
async function login(page: Page) {
  const seen: ClientPacket[] = [];
  let inject: (...packets: ServerPacket[]) => void = () => {};
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    inject = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      const packets = decoder.push(new Uint8Array(raw)).map(decodeClientPacket);
      const mine = packets.filter(p => !('unknown' in p) && (p.id === OC.SetHotkeySlot || p.id === KC.UseHKeySlot)) as ClientPacket[];
      seen.push(...mine);
      if (mine.length === 0) server.send(raw);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  return { seen, inject: (...packets: ServerPacket[]) => inject(...packets) };
}

test.describe('options window, key editor and hotkey bar', () => {
  test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'desktop-chrome', 'desktop layout'); });

  test('options: three tabs, FPS and copy-dialogs persist in ao.options.v1, Escape closes from every tab', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    await login(page);
    const options = page.getByRole('dialog', { name: 'Opciones', exact: true });
    await expect(options).toBeHidden();
    await page.locator('#settings').click();
    await expect(options).toBeVisible();
    // Three tabs: Jugabilidad (first), Video, Audio.
    await expect(options.getByRole('tab')).toHaveCount(3);
    await expect(page.locator('#options-panel-jugabilidad')).toBeVisible();
    await page.locator('[data-option="copy-dialog"]').check();
    await page.locator('#options-tab-video').click();
    await expect(page.locator('#options-panel-video')).toBeVisible();
    await expect(page.locator('#fps')).toBeHidden();
    await page.locator('[data-option="fps"]').check();
    await expect(page.locator('#fps')).toBeVisible();
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ao.options.v1') ?? '{}'));
    expect(await stored()).toMatchObject({ showFps: true, copyDialogToConsole: true });
    await page.keyboard.press('Escape');
    await expect(options).toBeHidden();
    // Escape closes the window whichever tab is showing (window stack, not the widget's own listener).
    for (const tab of ['jugabilidad', 'video', 'audio']) {
      await page.locator('#settings').click();
      await expect(options).toBeVisible();
      await page.locator(`#options-tab-${tab}`).click();
      await page.keyboard.press('Escape');
      await expect(options).toBeHidden();
    }
    await page.reload();
    await page.locator('#connect').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
    await expect(page.locator('#fps')).toBeVisible();
    expect(failures).toEqual([]);
  });

  test('key editor: capture, refusals, Guardar / Restaurar, presets, ao.keys.v1 survives a reload', async ({ page }) => {
    await login(page);
    await page.locator('#settings').click();
    await page.locator('#options-keys').click();
    const keys = page.getByRole('dialog', { name: 'Configuración de controles' });
    await expect(keys).toBeVisible();
    const box = (action: number) => page.locator(`#keys [data-action="${action}"]`);
    const message = page.locator('#keys .keys-msg');
    // Capture: the next key pressed becomes the binding (action 2 is "recoger", default modern binding is not Z).
    await box(2).focus(); await page.keyboard.press('KeyZ');
    await expect(box(2)).toHaveText('Z');
    // A key already bound to another action is refused and the box keeps its value.
    const taken = await box(3).innerText();
    await box(3).focus(); await page.keyboard.press('KeyZ');
    await expect(message).toContainText('ya está asignada');
    await expect(box(3)).toHaveText(taken);
    await expect(box(3)).toHaveAttribute('data-bad', 'true');
    // Arrows are only for the four movement actions (14..17).
    await box(5).focus(); await page.keyboard.press('ArrowUp');
    await expect(message).toContainText('flechas');
    await box(14).focus(); await page.keyboard.press('ArrowLeft');
    await expect(message).toHaveText('');
    await expect(box(14)).toHaveText('Flecha Izquierda');
    // Guardar writes ao.keys.v1 and closes the editor.
    await page.locator('#keys-save').click();
    await expect(keys).toBeHidden();
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ao.keys.v1') ?? '{}'));
    expect(await saved()).toMatchObject({ 2: 90 });
    // Reload: the binding is still there and the editor shows it.
    await page.reload();
    await page.locator('#connect').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
    await page.locator('#settings').click(); await page.locator('#options-keys').click();
    await expect(box(2)).toHaveText('Z');
    // Presets load at once and tick their radio; Restaurar goes back to the shipped table.
    await page.locator('input[data-preset="classic"]').click();
    await expect(page.locator('input[data-preset="classic"]')).toBeChecked();
    expect(await box(2).innerText()).not.toBe('Z');
    await box(2).focus(); await page.keyboard.press('KeyZ');
    await page.locator('#keys-restore').click();
    await expect(page.locator('input[data-preset="modern"]')).toBeChecked();
    // Closing with unsaved changes asks first, Escape on the box does not close the editor, "No" discards.
    await box(2).focus(); await page.keyboard.press('KeyZ');
    await page.locator('#keys-close').click();
    await expect(page.locator('#keys .keys-ask')).toBeVisible();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(keys).toBeHidden();
  });

  test('hotkey bar: appears with hotokey-enabled, right-drag of a bindable spell binds a slot, the bound key uses it', async ({ page }) => {
    const { seen, inject } = await login(page);
    const bar = page.locator('#hotkeys');
    await expect(bar).toBeHidden();
    inject({ id: OS.SendClientToggles, toggles: [HOTKEY_TOGGLE] });
    await expect(bar).toBeVisible();
    await expect(bar.locator('.hk-slot')).toHaveCount(10);
    // Spell slot 1 is declared bindable by the server (ChangeSpellSlot.bindable), slot 2 is not.
    inject({ id: SP.ChangeSpellSlot, slot: 1, spell: 1, index: 1, bindable: true }, { id: SP.ChangeSpellSlot, slot: 2, spell: 2, index: 2, bindable: false });
    await page.getByRole('tab', { name: 'Hechizos', exact: true }).click();
    const spell = page.locator('#spell-1');
    await expect(spell).toBeVisible();
    const slot = await box(bar.locator('.hk-slot').nth(2));
    // A non-bindable spell binds nothing (picHechiz_MouseDown) and a real mouse drag selects no text.
    await expect(page.locator('#spell-2')).toBeVisible();
    const plain = await box(page.locator('#spell-2'));
    await page.mouse.move(plain.x + 10, plain.y + 5); await page.mouse.down({ button: 'right' });
    await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 8 }); await page.mouse.up({ button: 'right' });
    await page.mouse.move(plain.x + 10, plain.y + 5); await page.mouse.down();
    await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 8 }); await page.mouse.up();
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
    expect(seen.find(p => p.id === OC.SetHotkeySlot && (p as { index: number }).index === 2)).toBeUndefined();
    const from = await box(spell);
    await page.mouse.move(from.x + 10, from.y + 5);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    // On login the client re-sends its saved slots; the drop is the one that puts spell 1 (type Spell) on slot 2.
    const bound = () => seen.find(p => p.id === OC.SetHotkeySlot && (p as { index: number }).index === 1);
    await expect.poll(bound).toBeDefined();
    expect(bound()).toMatchObject({ id: OC.SetHotkeySlot, slot: 2, index: 1, type: 2 });
    // The slot shows the spell and its key label; pressing that key sends UseHKeySlot for the slot.
    const label = (await bar.locator('.hk-slot').nth(2).locator('.hk-label').innerText()).trim();
    expect(label).not.toBe('');
    await expect(bar.locator('.hk-slot').nth(2)).toHaveAttribute('title', /.+/);
    await page.locator('#viewport canvas[tabindex]').focus();
    await page.keyboard.press(/^\d$/.test(label) ? `Digit${label}` : `Key${label.toUpperCase()}`);
    await expect.poll(() => seen.filter(p => p.id === KC.UseHKeySlot).length).toBe(1);
    expect(seen.find(p => p.id === KC.UseHKeySlot)).toMatchObject({ slot: 2 });
  });

  test('hotkey bar: a bindable item right-dragged from the inventory binds as type Item and is not thrown', async ({ page }) => {
    const { seen, inject } = await login(page);
    inject({ id: OS.SendClientToggles, toggles: [HOTKEY_TOGGLE] });
    const bar = page.locator('#hotkeys');
    await expect(bar).toBeVisible();
    inject({ id: SP.ChangeInventorySlot, slot: 20, object: 38, amount: 5, equipped: false, value: 10, canUse: 1, elementalTags: 0, bindable: true });
    const item = page.locator('#inventory .inventory-slot:nth-child(20)');
    await expect(item).toHaveAttribute('aria-label', /.+/);
    const from = (await item.boundingBox())!, slot = (await bar.locator('.hk-slot').nth(4).boundingBox())!;
    await page.mouse.move(from.x + 16, from.y + 16); await page.mouse.down({ button: 'right' });
    await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2, { steps: 8 }); await page.mouse.up({ button: 'right' });
    await expect.poll(() => seen.find(p => p.id === OC.SetHotkeySlot && (p as { index: number }).index === 38)).toBeDefined();
    expect(seen.find(p => p.id === OC.SetHotkeySlot && (p as { index: number }).index === 38)).toMatchObject({ slot: 4, index: 38, type: 1 });
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
  });

  test('clicking the Hechizos tab while holding a movement key does not stop the walk', async ({ page }) => {
    await login(page);
    const confirmed = async () => Number(await page.locator('#confirmed').textContent());
    await page.keyboard.down('ArrowRight');
    await expect.poll(confirmed).toBeGreaterThanOrEqual(2);
    await page.getByRole('tab', { name: 'Hechizos', exact: true }).click();
    await expect(page.locator('#spells')).toBeVisible();
    const before = await confirmed();
    await expect.poll(confirmed).toBeGreaterThan(before + 1);
    await page.keyboard.up('ArrowRight');
  });

  test('clicking the game viewport draws no focus outline and keyboard movement still works', async ({ page }) => {
    await login(page);
    const canvas = page.locator('#viewport canvas[tabindex]');
    await canvas.click({ position: { x: 20, y: 20 } });
    await expect(canvas).toBeFocused();
    expect(await canvas.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('none');
    const confirmed = async () => Number(await page.locator('#confirmed').textContent());
    const before = await confirmed();
    await page.keyboard.down('ArrowRight');
    await expect.poll(confirmed).toBeGreaterThan(before);
    await page.keyboard.up('ArrowRight');
  });
});
