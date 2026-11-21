import { test, expect } from '@playwright/test';
import { FrameDecoder, ItemsClientPacketId as IC, ServerPacketId as S, decodeClientPacket, encodeServerFrame } from '../../../packages/protocol/src/index.js';
import type { ClientPacket, ServerPacket } from '../../../packages/protocol/src/index.js';

// Items against the stand-in server (#20 item 3). Dat/Obj.dat is served from a tiny fixture so object types do not depend on the local
// resource tree; item packets are answered here (the stand-in does not know them), everything else goes to the stand-in.
const OBJ_DAT = [
  '[OBJ1]', 'Name=Manzana Roja', 'GrhIndex=10', 'ObjType=1',
  '[OBJ2]', 'Name=Espada Larga', 'GrhIndex=11', 'ObjType=2', 'MinHit=6', 'MaxHit=12',
  '[OBJ3]', 'Name=Arco', 'GrhIndex=12', 'ObjType=2', 'proyectil=1', 'MinHit=2', 'MaxHit=5',
].join('\r\n');
const slotPacket = (slot: number, object: number, amount: number, equipped: boolean): ServerPacket => ({
  id: S.ChangeInventorySlot, slot, object, amount, equipped, value: 0, canUse: 1, elementalTags: 0, bindable: false,
} as ServerPacket);

test('items: use an apple, equip and unequip gear, projectile weapon uses; counters increase per family', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/ao-assets/Dat/Obj.dat', route => route.fulfill({ body: OBJ_DAT, contentType: 'text/plain' }));
  const seen: ClientPacket[] = [];
  let reply: (...packets: ServerPacket[]) => void = () => {};
  const mine = new Set<number>([IC.UseItem, IC.EquipItem, IC.UseItemU, IC.Drop, IC.PickUp]);
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    reply = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      const packets = decoder.push(new Uint8Array(raw)).map(decodeClientPacket);
      if (packets.some(p => !('unknown' in p) && mine.has(p.id))) { for (const p of packets) if (!('unknown' in p)) seen.push(p as ClientPacket); return; }
      server.send(raw);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  reply(slotPacket(1, 1, 5, false), slotPacket(2, 2, 1, false), slotPacket(3, 3, 1, false));
  const slot = (n: number) => page.locator(`#inventory .inventory-slot:nth-child(${n})`);
  await expect(slot(2)).toBeVisible();

  // An apple is used: UseItem(slot, fromInventory) with the first counter of its family.
  await slot(1).dblclick();
  await expect.poll(() => seen.length).toBe(1);
  expect(seen[0]).toMatchObject({ id: IC.UseItem, slot: 1, fromInventory: true, counter: 1 });
  // A sword is equipped (EquipItem); once the server confirms it is equipped a double click does nothing more.
  await slot(2).dblclick();
  await expect.poll(() => seen.length).toBe(2);
  expect(seen[1]).toMatchObject({ id: IC.EquipItem, slot: 2, skin: false, counter: 1 });
  reply(slotPacket(2, 2, 1, true));
  await page.waitForTimeout(300);
  await slot(2).dblclick(); await page.waitForTimeout(400);
  expect(seen).toHaveLength(2);
  // An equipped projectile weapon is used (asks the server for a target); the use counter keeps counting.
  await slot(3).dblclick(); await expect.poll(() => seen.length).toBe(3);
  expect(seen[2]).toMatchObject({ id: IC.EquipItem, slot: 3, counter: 2 });
  reply(slotPacket(3, 3, 1, true)); await page.waitForTimeout(300);
  await page.waitForTimeout(600); // the use interval of the stand-in
  await slot(3).dblclick(); await expect.poll(() => seen.length).toBe(4);
  expect(seen[3]).toMatchObject({ id: IC.UseItem, slot: 3, fromInventory: true, counter: 2 });
  expect(failures).toEqual([]);
});
