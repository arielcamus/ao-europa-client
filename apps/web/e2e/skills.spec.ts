import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import {
  FrameDecoder, SkillsClientPacketId as SC, SkillsServerPacketId as SS, decodeClientPacket, encodeServerFrame,
} from '../../../packages/protocol/src/index.js';
import type { ServerPacket } from '../../../packages/protocol/src/index.js';

// Skill, statistics and trainer windows against the stand-in server. The stand-in knows no skill packets, so the page's WebSocket
// is intercepted: skill requests (7, 8, 46, 47, 52, 85, 86, 87) are answered here with VB6-shaped packets, the rest goes to the stand-in.
test('skills: skill points window, statistics tabs and trainer list', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const requests: unknown[] = [];
  let reply: (...packets: ServerPacket[]) => void = () => {};
  const mine = new Set<number>([SC.ModifySkills, SC.Train, SC.TrainList, SC.Rest, SC.RequestStats, SC.RequestAtributes, SC.RequestSkills, SC.RequestMiniStats]);
  const skills = Array.from({ length: 24 }, (_, i) => (i === 0 ? 12 : i === 4 ? 30 : 0));
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    reply = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      const packets = decoder.push(new Uint8Array(raw)).map(decodeClientPacket);
      if (packets.some(p => !('unknown' in p) && mine.has(p.id))) {
        for (const p of packets) {
          if ('unknown' in p) continue;
          requests.push(p);
          if (p.id === SC.RequestSkills) reply({ id: SS.SendSkills, skills });
          if (p.id === SC.RequestAtributes) reply({ id: SS.Atributes, strength: 19, agility: 19, intelligence: 18, constitution: 20, charisma: 18 });
          if (p.id === SC.RequestMiniStats) reply({ id: SS.MiniStats, citizensKilled: 1, criminalsKilled: 2, alignment: 1, npcsKilled: 33, classId: 3, jailMinutes: 4, deaths: 5, gender: 1, fishingPoints: 6, race: 5 });
        }
        return;
      }
      server.send(raw);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await mkdir('artifacts/screenshots', { recursive: true });
  reply({ id: SS.LevelUp, skillPoints: 5 });

  // The skills arrow: RequestSkills, then the window opens with the server's values and the points left.
  await page.getByRole('button', { name: 'Skills' }).click();
  const win = page.locator('#skills-window');
  await expect(win).toBeVisible();
  expect(requests).toEqual([{ id: SC.RequestSkills }]);
  const value = (skill: number) => win.locator('.sk-value').nth(skill);
  await expect(value(0)).toHaveText('12');
  await expect(win.locator('.sk-label').first()).toHaveText('5');
  // Arrows: plus spends a point (red), minus returns only what this window added, points never go below zero.
  const plus = (name: string) => win.getByRole('button', { name: `${name}: más` });
  const minus = (name: string) => win.getByRole('button', { name: `${name}: menos` });
  await plus('Magia').click(); await plus('Magia').click(); await plus('Tala').click();
  await expect(value(0)).toHaveText('14'); await expect(value(0)).toHaveCSS('color', 'rgb(255, 0, 0)');
  await expect(win.locator('.sk-label').first()).toHaveText('2');
  await minus('Magia').click(); await minus('Meditar').click();
  await expect(value(0)).toHaveText('13');
  await expect(win.locator('.sk-label').first()).toHaveText('3');
  await plus('Meditar').click(); await plus('Meditar').click(); await plus('Meditar').click(); await plus('Meditar').click();
  await expect(win.locator('.sk-label').first()).toHaveText('0');
  await page.screenshot({ path: 'artifacts/screenshots/skills-window.png' });
  // Aceptar with changes asks first; No closes without sending, Yes sends only the added points.
  await win.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(win.locator('.sk-msg-text')).toContainText('Realizó cambios en sus skillpoints');
  await win.locator('.sk-msg-button', { hasText: /^No$/ }).click();
  await expect(win).toBeHidden();
  expect(requests.some(r => (r as { id: number }).id === SC.ModifySkills)).toBe(false);
  await page.getByRole('button', { name: 'Skills' }).click();
  await expect(win).toBeVisible();
  await plus('Magia').click(); await plus('Domar').click();
  await win.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await win.locator('.sk-msg-button', { hasText: /^Sí$/ }).click();
  await expect(win).toBeHidden();
  const sent = requests.at(-1) as { id: number; points: number[] };
  expect(sent.id).toBe(SC.ModifySkills);
  expect(sent.points).toEqual(Array.from({ length: 24 }, (_, i) => (i === 0 || i === 23 ? 1 : 0)));

  // Estadísticas (info panel): both requests, then the window with the character tab; tabs swap the labels.
  await page.locator('#menu-tab').click();
  await page.getByRole('button', { name: 'Estadísticas' }).click();
  const stats = page.locator('#stats-window');
  await expect(stats).toBeVisible();
  expect(requests.slice(-2)).toEqual([{ id: SC.RequestAtributes }, { id: SC.RequestMiniStats }]);
  await expect(stats.locator('.sk-stat:visible')).toHaveText(['Guerrero', 'Enano', 'Hombre', 'Ciudadano', '4 min', '19', '19', '18', '20', '18']);
  await page.screenshot({ path: 'artifacts/screenshots/skills-stats-personaje.png' });
  await stats.getByRole('button', { name: 'Combate' }).click();
  await expect(stats.locator('.sk-stat:visible')).toHaveText(['2', '1', '33']) // DOM order: criminals (y254), citizens (y235), npcs;
  await stats.getByRole('button', { name: 'Pesca' }).click();
  await expect(stats.locator('.sk-stat:visible')).toHaveText(['6']);
  await stats.getByRole('button', { name: 'Aceptar' }).click();
  await expect(stats).toBeHidden();

  // Trainer: the creature list, Luchar sends the 1-based choice.
  reply({ id: SS.TrainerCreatureList, creatures: ['Lobo', 'Oso', 'Tigre'] });
  const trainer = page.locator('#trainer-window');
  await expect(trainer).toBeVisible();
  await expect(trainer.locator('.sk-trainer-row')).toHaveText(['Lobo', 'Oso', 'Tigre']);
  await trainer.locator('.sk-trainer-row').nth(1).click();
  await page.screenshot({ path: 'artifacts/screenshots/skills-trainer.png' });
  await trainer.getByRole('button', { name: 'Luchar' }).click();
  await expect(trainer).toBeHidden();
  expect(requests.at(-1)).toEqual({ id: SC.Train, creature: 2 });
  expect(failures).toEqual([]);
});
