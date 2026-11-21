import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import {
  FrameDecoder, QuestClientPacketId as QC, QuestServerPacketId as QS, decodeClientPacket, encodeServerFrame,
} from '../../../packages/protocol/src/index.js';
import type { ServerPacket } from '../../../packages/protocol/src/index.js';
import { serverFixtures } from '../../../packages/protocol/test/fixtures.js';

// Quest forms against the stand-in server. The stand-in knows no quest packets, so the page's WebSocket is intercepted: quest
// requests (258..262) are answered here with VB6-shaped packets and everything else goes to the stand-in.
test('quests: Quests button, log, details, abandon with confirmation, NPC offer and accept', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const requests: unknown[] = [];
  let list = [4];
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    const reply = (...packets: ServerPacket[]) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const bytes = typeof message === 'string' ? Buffer.from(message) : message;
      const bodies = decoder.push(new Uint8Array(bytes));
      const packets = bodies.map(decodeClientPacket);
      if (packets.some(p => !('unknown' in p) && p.id >= 258 && p.id <= 262)) {
        for (const p of packets) {
          if ('unknown' in p) continue;
          requests.push(p);
          if (p.id === QC.QuestListRequest) reply({ id: QS.QuestListSend, quests: list });
          if (p.id === QC.QuestDetailsRequest) reply({
            id: QS.QuestDetails, questIndex: 4, requiredLevel: 1, limitLevel: 0, requiredClasses: [], requiredQuest: 0,
            npcs: [{ amount: 10, npcIndex: 502, killed: 4 }], objs: [{ amount: 10, objIndex: 2492, have: 2 }], spells: [], skillType: 0, skillValue: 0,
            rewardGold: 4, rewardExp: 0, rewardObjs: [{ amount: 10, objIndex: 2497 }], rewardSpells: [], talkTo: 0, deliverMap: 44,
          });
          if (p.id === QC.QuestAbandon) { list = []; reply({ id: QS.QuestListSend, quests: [] }); }
          if (p.id === QC.QuestAccept) reply({ id: QS.UpdateNPCSimbolo, charIndex: 0x1234, symbol: 4 });
        }
        return;
      }
      server.send(message);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
    (page as unknown as { reply: typeof reply }).reply = reply;
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await mkdir('artifacts/screenshots', { recursive: true });

  // Quests button of the info panel: WriteQuestListRequest, then the server's list; the first quest's details are requested at once.
  await page.locator('#menu-tab').click();
  await page.getByRole('button', { name: 'Quests' }).click();
  const log = page.locator('#quest-log');
  await expect(log).toBeVisible();
  await expect(log.locator('.q-main-list .q-row')).toHaveText(['Veneno mortal']);
  await expect(log.locator('.q-title')).toHaveText('Veneno mortal');
  await expect(log.locator('.q-repeatable')).toBeHidden();
  await expect(log.locator('.q-center')).toContainText('serpientes');
  await expect(log.locator('.q-table').first().locator('.q-trow')).toHaveText(['Serpiente4/10', 'Fluido de serpiente2/10']);
  await expect(log.locator('.q-left')).toHaveText('Mapa de entrega: 44');
  expect(requests).toEqual([{ id: QC.QuestListRequest }, { id: QC.QuestDetailsRequest, slot: 1 }]);
  await page.screenshot({ path: 'artifacts/screenshots/quests-log.png' });
  // MoverForm: dragging the form background moves the log; a list row stays clickable and does not start a drag.
  const origin = await log.boundingBox();
  await page.mouse.move(origin!.x + 10, origin!.y + 60); await page.mouse.down(); await page.mouse.move(origin!.x + 50, origin!.y + 90, { steps: 4 }); await page.mouse.up();
  const dragged = await log.boundingBox();
  expect(Math.round(dragged!.x - origin!.x)).toBeGreaterThan(20); expect(Math.round(dragged!.y - origin!.y)).toBeGreaterThan(10);
  await page.screenshot({ path: 'artifacts/screenshots/wp-b-quest-log-dragged.png' });

  // Abandon needs a selected row first (MENSAJE_SELECCIONAR_MISION), then a confirmation (MENSAJE_ABANDONAR_MISION).
  await log.getByRole('button', { name: 'Abandonar' }).click();
  await expect(log.locator('.q-msg-text')).toHaveText('¡Primero debes seleccionar una misión!');
  await log.locator('.q-msg-button').click();
  await log.locator('.q-main-list .q-row').click();
  await log.getByRole('button', { name: 'Abandonar' }).click();
  await expect(log.locator('.q-msg-text')).toContainText('¿Estás seguro');
  await log.getByRole('button', { name: 'No' }).click();
  expect(requests.some(r => (r as { id: number }).id === QC.QuestAbandon)).toBe(false);
  await log.getByRole('button', { name: 'Abandonar' }).click();
  await log.getByRole('button', { name: 'Sí' }).click();
  await expect(log.locator('.q-main-list .q-row')).toHaveCount(0);
  expect(requests.at(-1)).toEqual({ id: QC.QuestAbandon, slot: 1 });
  await page.keyboard.press('Escape');
  await expect(log).toBeHidden();

  // An NPC offer: rows are coloured by state, Aceptar sends the 1-based row and closes the form.
  const reply = (page as unknown as { reply: (...p: ServerPacket[]) => void }).reply;
  const offered = (questIndex: number, state: number) => ({
    questIndex, requiredLevel: state === 3 ? 6 : 1, requiredQuest: 0, requiredClasses: state === 3 ? [9] : [], limitLevel: 0,
    npcs: [{ amount: 10, npcIndex: 502 }], objs: [], spells: [], skillType: 0, skillValue: 0, rewardGold: 4, rewardExp: 0, rewardObjs: [], rewardSpells: [], state,
  });
  reply({ id: QS.NpcQuestListSend, quests: [offered(4, 0), offered(2, 3)] });
  const offers = page.locator('#quest-offers');
  await expect(offers).toBeVisible();
  await expect(offers.locator('.q-offer-row')).toHaveText(['Veneno mortal', 'Primeros pasos en la Alquimia']);
  await expect(offers.locator('.q-offer-row').nth(1)).toHaveCSS('color', 'rgb(255, 10, 10)');
  await offers.locator('.q-offer-row').nth(1).click();
  await expect(offers.locator('.q-center')).toContainText('Requisitos');
  await expect(offers.locator('.q-center')).toContainText('Clase: Trabajador');
  await page.screenshot({ path: 'artifacts/screenshots/quests-offer.png' });
  await offers.locator('.q-offer-row').first().click();
  await offers.getByRole('button', { name: 'Aceptar' }).click();
  await expect(offers).toBeHidden();
  expect(requests.at(-1)).toEqual({ id: QC.QuestAccept, slot: 1 });

  // The quest marker over an NPC (UpdateNPCSimbolo): drawn once the server sets it.
  const self = serverFixtures.CharacterCreate;
  reply({ ...self, charIndex: 77, name: 'Makrom', npc: 1, npcNumber: 407, body: 107, head: 1, x: 52, y: 50, symbol: 0 }); // the stand-in places the player at 50,50
  await page.waitForTimeout(400);
  const before = await page.locator('#viewport').screenshot();
  reply({ id: QS.UpdateNPCSimbolo, charIndex: 77, symbol: 4 });
  await page.waitForTimeout(400);
  const after = await page.locator('#viewport').screenshot();
  expect(Buffer.compare(before, after)).not.toBe(0);
  await page.screenshot({ path: 'artifacts/screenshots/quests-npc-symbol.png' });
  expect(failures).toEqual([]);
});
