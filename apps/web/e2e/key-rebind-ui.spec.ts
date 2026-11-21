import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import {
  FrameDecoder, ServerPacketId as SP, OptionsClientPacketId as OC, OptionsServerPacketId as OS, KeysClientPacketId as KC, ItemsClientPacketId as IC,
  HOTKEY_TOGGLE, decodeClientPacket, encodeServerFrame,
} from '../../../packages/protocol/src/index.js';
import type { ClientPacket, ServerPacket } from '../../../packages/protocol/src/index.js';

// Ariel, 21 Nov (on a Mac, live server): "I still don't start meditating when pressing 'delete' even though I set up that custom key" and
// "Still can't assign shortcuts on keys 1-2-3...9-0". These tests take a human's path, never localStorage injection: the key editor
// (frmCustomKeys) through the options window, the Mac "delete" key (KeyboardEvent.code Backspace = vbKeyBack 8), a walk first (the meditate
// key went dead after the first step: a motion test the VB6 Accionar does not have), the chat and the inventory taking the focus, and a reload.
// The hotkey bar is bound by the right button (picHechiz_MouseDown / InventoryWindow_MouseDown); on a Mac Control+click is the right button.

type Seen = ClientPacket[];
async function login(page: Page, swallow: (p: ClientPacket) => boolean = () => false) {
  const seen: Seen = [];
  let inject: (...packets: ServerPacket[]) => void = () => {};
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    inject = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      const packets = decoder.push(new Uint8Array(raw)).map(decodeClientPacket).filter(p => !('unknown' in p)) as ClientPacket[];
      seen.push(...packets);
      if (!packets.some(swallow)) server.send(raw);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  const enter = async () => {
    await page.goto('/');
    await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
    await page.locator('#connect').click();
    await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  };
  await enter();
  return { seen, enter, inject: (...packets: ServerPacket[]) => inject(...packets) };
}
/** The spell list is rebuilt on every UI revision, so a row found a moment ago can be detached when its box is read: read it again. */
async function boxOf(locator: Locator) {
  let rect: { x: number; y: number; width: number; height: number } | null = null;
  await expect.poll(async () => (rect = await locator.boundingBox()) !== null).toBe(true);
  return rect!;
}
const count = (seen: Seen, id: number) => seen.filter(p => p.id === id).length;

/** Options button -> "Configurar teclas" -> click the Meditar box -> press the key -> Guardar -> close the options window. */
async function rebindMeditar(page: Page, key: string, shown: string) {
  await page.locator('#settings').click();
  await expect(page.getByRole('dialog', { name: 'Opciones', exact: true })).toBeVisible();
  await page.locator('#options-keys').click();
  const box = page.locator('#keys .keys-box[data-action="21"]');
  await box.click();
  await page.keyboard.press(key);
  await expect(box).toHaveText(shown);
  await expect(page.locator('#keys .keys-msg')).toHaveText('');
  await page.locator('#keys-save').click();
  await expect(page.locator('#keys')).toBeHidden();
  await page.locator('#options-close').click();
  await expect(page.locator('#options')).toBeHidden();
}

test.describe('key editor and hotkey bar, the way a Mac player uses them', () => {
  test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'desktop-chrome', 'desktop layout'); });

  test('Meditar rebound to the Mac delete key in the editor meditates after a walk, the chat, the inventory and a reload', async ({ page }) => {
    const { seen, enter } = await login(page);
    await rebindMeditar(page, 'Backspace', 'Borrar');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('ao.keys.v1') ?? '{}')['21'])).toBe(8);
    const url = page.url();
    // Right after closing the options window (focus on the page body).
    await page.keyboard.press('Backspace');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(1);
    // Walk one tile first (D, [DEFAULTSMODERN] binding 17): the key must still work once the step is over.
    const confirmed = async () => Number(await page.locator('#confirmed').textContent());
    const before = await confirmed();
    await page.keyboard.down('KeyD'); await expect.poll(confirmed).toBeGreaterThan(before); await page.keyboard.up('KeyD');
    await page.waitForTimeout(400);
    await page.locator('#viewport canvas[tabindex]').click({ position: { x: 40, y: 40 } });
    await page.keyboard.press('Backspace');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(2);
    // The chat box takes the focus: Backspace edits the text there; once it is closed the key meditates again.
    await page.keyboard.press('Enter');
    await expect(page.locator('#chat')).toBeFocused();
    await page.keyboard.type('ab'); await page.keyboard.press('Backspace');
    await expect(page.locator('#chat')).toHaveValue('a');
    expect(count(seen, KC.Meditate)).toBe(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Backspace');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(3);
    // An inventory slot keeps the focus after a click; the game keys still work from it.
    await page.locator('#inventory .inventory-slot').first().click();
    await page.keyboard.press('Backspace');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(4);
    // Backspace never navigated away.
    expect(page.url()).toBe(url);
    // The binding survives a reload and a new login.
    await enter();
    await expect(page.locator('#viewport canvas[tabindex]')).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(5);
  });

  test('Meditar on Delete meditates; with full mana Accionar bails out and Delete opens the clan chat, as in VB6', async ({ page }) => {
    const { seen, inject } = await login(page);
    await rebindMeditar(page, 'Delete', 'Delete');
    await page.keyboard.press('Delete');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(1);
    await expect(page.locator('#chat-form')).toBeHidden();
    // The stand-in's mana is 60/80: fill it (UpdateMana), then minman = maxman makes Accionar exit before `Accionar = True`.
    inject({ id: SP.UpdateMana, mana: 80 });
    await page.waitForTimeout(200);
    await page.keyboard.press('Delete');
    await expect(page.locator('#chat-form')).toBeVisible();
    await expect(page.locator('#chat-form')).toHaveClass(/guild/);
    expect(count(seen, KC.Meditate)).toBe(1);
  });

  test('a key of a Spanish Mac keyboard (ñ, code Semicolon) can be bound, as frmCustomKeys takes any key code', async ({ page }) => {
    const { seen } = await login(page);
    await rebindMeditar(page, 'Semicolon', 'º'); // VB6 prints Chr(KeyCode): VK_OEM_1 = 186
    await page.keyboard.press('Semicolon');
    await expect.poll(() => count(seen, KC.Meditate)).toBe(1);
  });

  for (const [platform, binds] of [['MacIntel', true], ['Win32', false]] as const) {
    test(`hotkey bar on ${platform}: Control+click drag of a bindable spell and item ${binds ? 'binds them (the Mac right button)' : 'binds nothing'}`, async ({ page }) => {
      await page.addInitScript(p => Object.defineProperty(Navigator.prototype, 'platform', { get: () => p }), platform);
      const { seen, inject } = await login(page, p => p.id === OC.SetHotkeySlot || p.id === KC.UseHKeySlot);
      inject({ id: OS.SendClientToggles, toggles: [HOTKEY_TOGGLE] });
      const bar = page.locator('#hotkeys');
      await expect(bar).toBeVisible();
      inject({ id: SP.ChangeSpellSlot, slot: 1, spell: 1, index: 1, bindable: true });
      inject({ id: SP.ChangeInventorySlot, slot: 20, object: 38, amount: 5, equipped: false, value: 10, canUse: 1, elementalTags: 0, bindable: true });
      const drop = async (from: string, to: number) => {
        const a = await boxOf(page.locator(from)), b = await boxOf(bar.locator('.hk-slot').nth(to));
        await page.mouse.move(a.x + 12, a.y + 8);
        await page.keyboard.down('Control'); await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
        await page.mouse.up(); await page.keyboard.up('Control');
      };
      const item = page.locator('#inventory .inventory-slot:nth-child(20)');
      await expect(item).toHaveAttribute('aria-label', /.+/);
      await drop('#inventory .inventory-slot:nth-child(20)', 4);
      await page.getByRole('tab', { name: 'Hechizos', exact: true }).click();
      await expect(page.locator('#spell-1')).toBeVisible();
      await drop('#spell-1', 2);
      await page.waitForTimeout(300);
      const set = (index: number) => seen.find(p => p.id === OC.SetHotkeySlot && (p as { index: number }).index === index);
      // The item is never thrown on the floor when let go over the bar.
      expect(count(seen, IC.Drop)).toBe(0);
      if (!binds) { expect(set(1)).toBeUndefined(); expect(set(38)).toBeUndefined(); return; }
      expect(set(38)).toMatchObject({ slot: 4, index: 38, type: 1 });
      expect(set(1)).toMatchObject({ slot: 2, index: 1, type: 2 });
      // Number keys 3 and 5 (Atajo 3 / Atajo 5) use those slots.
      await page.locator('#viewport canvas[tabindex]').focus();
      await page.keyboard.press('Digit3'); await page.keyboard.press('Digit5');
      await expect.poll(() => seen.filter(p => p.id === KC.UseHKeySlot).map(p => (p as { slot: number }).slot)).toEqual([2, 4]);
    });
  }
});
