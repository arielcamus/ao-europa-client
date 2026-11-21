import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { FrameDecoder, PetsTravelClientPacketId, PetsTravelServerPacketId as PS, decodeClientPacket, encodeServerFrame } from '../../../packages/protocol/src/index.js';
import type { ClientPacket, ServerPacket } from '../../../packages/protocol/src/index.js';

// FrmViajes against the stand-in server: the page's WebSocket is intercepted so the server's ViajarForm can be injected (a Transporter NPC
// needs a battle server) and the client's CompletarViaje is captured.
test('travel: ViajarForm lists destinations, picking a row and Viajar sends CompletarViaje with its index and cost', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const received: ClientPacket[] = [];
  let reply: (...packets: ServerPacket[]) => void = () => {};
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    reply = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const bytes = typeof message === 'string' ? Buffer.from(message) : message;
      for (const body of decoder.push(new Uint8Array(bytes))) { const packet = decodeClientPacket(body); if (!('unknown' in packet)) received.push(packet); }
      server.send(message);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await mkdir('artifacts/screenshots', { recursive: true });

  reply({ id: PS.ViajarForm, destinations: [{ city: 'Ciudad de Arghal', cost: 6500 }, { city: 'Monte Perdido', cost: 3000 }], interface: 0 });
  const form = page.locator('#travel-window');
  await expect(form).toBeVisible();
  await expect(form.locator('.vb-row')).toHaveText(['Ciudad de Arghal - 6500 monedas', 'Monte Perdido - 3000 monedas']);
  await page.screenshot({ path: 'artifacts/screenshots/npcs-chat-travel-form.png' });
  // Nothing selected sends nothing; picking the second row sends its 1-based index and cost.
  await form.getByRole('button', { name: 'Viajar' }).click();
  expect(received.some(p => p.id === PetsTravelClientPacketId.CompletarViaje)).toBe(false);
  await form.locator('.vb-row').nth(1).click();
  await form.getByRole('button', { name: 'Viajar' }).click();
  await expect(form).toHaveCount(0);
  expect(received.find(p => p.id === PetsTravelClientPacketId.CompletarViaje)).toMatchObject({ destination: 2, cost: 3000 });
  expect(failures).toEqual([]);
});
