import { test, expect } from '@playwright/test';
import { FrameDecoder, KeysClientPacketId as KC, decodeClientPacket } from '../../../packages/protocol/src/index.js';

// Ariel, 21 Nov: Meditar rebound to the Mac "delete" key (KeyboardEvent.code "Backspace", VB6 vbKeyBack = 8) or to Delete (46) did nothing.
// Delete was hard-wired to the guild chat before the bindings were looked up (HandleKeyUp runs Accionar first). Any key the editor records must fire its action.
const BINDINGS_KEY = 'ao.keys.v1';
async function press(page: import('@playwright/test').Page, binding: Record<number, number> | undefined, key: string, code: string) {
  const meditate: number[] = [];
  if (binding) await page.addInitScript(([k, v]) => localStorage.setItem(k as string, v as string), [BINDINGS_KEY, JSON.stringify(binding)]);
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer(); const decoder = new FrameDecoder();
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      for (const p of decoder.push(new Uint8Array(raw)).map(decodeClientPacket)) if (!('unknown' in p) && p.id === KC.Meditate) meditate.push(1);
      server.send(raw);
    });
    ws.onClose(() => server.close()); server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.locator('#viewport').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press(code === key ? key : key);
  await page.waitForTimeout(600);
  return meditate.length;
}
test.describe('Meditar key rebinding', () => {
  test.beforeEach(async ({}, info) => { test.skip(info.project.name !== 'desktop-chrome', 'desktop layout'); });
  test('the default key (F6) meditates', async ({ page }) => { expect(await press(page, undefined, 'F6', 'F6')).toBe(1); });
  test('Meditar on Backspace (the Mac delete key) meditates', async ({ page }) => { expect(await press(page, { 21: 8, 22: 123 }, 'Backspace', 'Backspace')).toBe(1); });
  test('Meditar on Delete meditates instead of opening the guild chat', async ({ page }) => { expect(await press(page, { 21: 46, 22: 123 }, 'Delete', 'Delete')).toBe(1); });
});
