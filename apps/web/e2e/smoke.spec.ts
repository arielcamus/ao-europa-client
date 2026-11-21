import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  FrameDecoder, GuildServerPacketId as GS, PartyServerPacketId as PS, SkillsClientPacketId as SC, SkillsServerPacketId as SS,
  decodeClientPacket, encodeServerFrame, joinList,
} from '../../../packages/protocol/src/index.js';
import type { ClientPacket, ServerPacket } from '../../../packages/protocol/src/index.js';

// Top-level smoke: one session against the stand-in server walks the whole happy path of the client and opens every main window.
// The stand-in only knows login, walk and chat; the requests of the other windows (skills, statistics, group, guild list) are answered
// here with VB6-shaped packets by the intercepted WebSocket, like the skills and party specs do.
test('smoke: login, walk, chat, every main window, logout', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'keyboard and layout flow');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const sent: ClientPacket[] = [];
  let reply: (...packets: ServerPacket[]) => void = () => {};
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    reply = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      for (const body of decoder.push(new Uint8Array(raw))) {
        const packet = decodeClientPacket(body);
        if ('unknown' in packet) continue;
        sent.push(packet);
        if (packet.id === SC.RequestSkills) reply({ id: SS.SendSkills, skills: Array.from({ length: 24 }, (_, i) => (i === 0 ? 12 : 0)) });
        if (packet.id === SC.RequestAtributes) reply({ id: SS.Atributes, strength: 19, agility: 19, intelligence: 18, constitution: 20, charisma: 18 });
        if (packet.id === SC.RequestMiniStats) reply({ id: SS.MiniStats, citizensKilled: 1, criminalsKilled: 2, alignment: 1, npcsKilled: 33, classId: 3, jailMinutes: 4, deaths: 5, gender: 1, fishingPoints: 6, race: 5 });
        if (packet.id === 236) reply({ id: PS.DatosGrupo, inGroup: true, members: ['STANDIN(Líder)', 'Aotesta'] });
        if (packet.id === 84) reply({ id: GS.GuildList, guilds: joinList(['Los Pibes-0', 'Armada Alpha-1']) });
      }
      server.send(raw);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');

  // Login.
  await page.locator('#connect').click();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await expect(page.locator('#hp-text')).toHaveText('80 / 100');

  // Walk: holding an arrow key confirms steps; the position moves east.
  const start = await page.locator('#position').textContent();
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => Number(await page.locator('#confirmed').textContent())).toBeGreaterThanOrEqual(3);
  await page.keyboard.up('ArrowRight');
  expect(await page.locator('#position').textContent()).not.toBe(start);

  // Chat: Enter opens the box, Enter says it, the bubble and the console show it.
  await page.keyboard.press('Enter');
  await page.locator('#chat').fill('hola smoke');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat-bubble')).toHaveText('hola smoke');
  await expect(page.locator('#messages')).toContainText('hola smoke');

  // Every main window opens and Escape closes the top-most one.
  const closes = async (window: ReturnType<Page['locator']>) => { await expect(window).toBeVisible(); await page.keyboard.press('Escape'); await expect(window).toBeHidden(); };
  await page.locator('#settings').click();
  await closes(page.getByRole('dialog', { name: 'Opciones', exact: true }));
  await page.locator('#menu-tab').click();
  await page.getByRole('button', { name: 'Llavero', exact: true }).click();
  await closes(page.locator('#keyring-window'));
  await page.getByRole('button', { name: 'Grupo', exact: true }).click();
  await closes(page.locator('#frm-grupo'));
  await page.getByRole('button', { name: 'Clanes', exact: true }).click();
  await closes(page.locator('#frm-guild-list'));
  await page.getByRole('button', { name: 'Skills' }).click();
  await closes(page.locator('#skills-window'));
  await page.getByRole('button', { name: 'Estadísticas', exact: true }).click();
  await closes(page.locator('#stats-window'));
  // The duel form of the extras opens from a slash command.
  await page.locator('#viewport canvas[tabindex]').focus();
  await page.keyboard.press('Enter');
  await page.locator('#chat').fill('/RETAR');
  await page.keyboard.press('Enter');
  await closes(page.locator('#duel-window'));

  // Logout: the X of frmMain ends the stand-in session (the frmCerrar form belongs to the interactive account flow, connect-flow.spec.ts).
  await page.getByRole('button', { name: 'Leave world' }).click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#chat-form')).toBeHidden();
  expect(failures).toEqual([]);
});
