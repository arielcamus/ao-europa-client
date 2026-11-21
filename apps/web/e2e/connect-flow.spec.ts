import { test, expect } from '@playwright/test';
import { ServerPacketId as S, SessionServerPacketId as SS, encodeServerFrame, FrameDecoder, decodeClientPacket } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';

// The classic connect flow (account screen, character creation, message boxes, exit form) against a scripted server: the real VB6
// server refuses new characters once an IP passed its 15-per-run cap, so the creation packets are checked on the wire here
// (tests/fixtures/vb6/core-session holds what the real server answered when it still accepted them).
const character = { id: 7, name: 'Mockchar', body: 1, head: 1, characterClass: 3, map: 1, x: 57, y: 44, level: 4, status: 1, helmet: 0, shield: 0, weapon: 0, backpack: 0 };
const play: ServerPacket[] = [
  { id: S.Intervals, hit: 1000, bow: 1000, magic: 1000, extractWork: 1000, buildWork: 1000, walk: 300, dropItem: 100, useItemKey: 100, useItemClick: 100, hitMagic: 100, magicHit: 100, hitUseItem: 100, hide: 100, talk: 500, leftClick: 100, meditate: 100 },
  { id: S.ChangeMap, map: 1, resourceMap: 1 },
  { id: S.CharacterCreate, charIndex: 5, body: 1, head: 1, heading: 3, x: 57, y: 44, weapon: 0, shield: 0, helmet: 0, cart: 0, backpack: 0, fx: 0, fxLoops: 0, name: 'Mockchar', status: 1, privileges: 0, particleFx: 0,
    headAura: '', weaponAura: '', bodyAura: '', damageAura: '', resistanceAura: '', otherAura: '', shieldAura: '', speeding: 1, npc: 0, appear: 0, groupIndex: 0, clanIndex: 0, clanLevel: 0,
    minHp: 20, maxHp: 20, minMana: 0, maxMana: 0, symbol: 0, flags: 0, userType: 0, team: 0, flag: 0, npcNumber: 0, clanAlignment: 0 },
  { id: S.UserCharIndexInServer, charIndex: 5 },
  { id: S.Logged, newUser: true },
];

test('connect flow: account screen, refused then accepted character creation, exit form', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'pointer flow');
  const received: { id: number; hex: string }[] = [];
  let created = 0;
  await page.route('**/ao-config.json', route => route.fulfill({ json: { mode: 'classic', serverProfile: 'classic', wsPath: '/bridge' } }));
  await page.routeWebSocket(/\/bridge/, ws => {
    const decoder = new FrameDecoder();
    const send = (...packets: ServerPacket[]) => { for (const p of packets) ws.send(Buffer.from(encodeServerFrame(p))); };
    send({ id: S.Connected, debugging: false });
    ws.onMessage(message => {
      for (const body of decoder.push(Uint8Array.from(message as Buffer))) {
        const packet = decodeClientPacket(body);
        received.push({ id: packet.id, hex: Buffer.from(body).toString('hex') });
        if (packet.id === 305) send({ id: S.AccountCharacterList, characters: [character] });
        if (packet.id === 74) { created++; if (created === 1) send({ id: SS.ShowMessageBox, messageId: 1769, extra: '' }); else send(...play); }
        if (packet.id === 73) send(...play);
      }
    });
  });
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#connect')).toBeEnabled();
  await expect(page.locator('#connect-stage')).toHaveAttribute('data-screen', 'login');
  await page.locator('#email').fill('mock@local.test'); await page.locator('#password').fill('secret12');
  await page.locator('#connect').click();
  await expect(page.locator('#connect-stage')).toHaveAttribute('data-screen', 'account');
  await expect(page.locator('.cs-slot-name')).toHaveText('Mockchar');
  await expect(page.locator('.cs-info')).toContainText('Nivel: 4');
  // Select_part (stream 203) is ONE swirl centred on the selected slot, not a box: its layout box is the 128 px particle sprite at
  // (x + 32 - 16 + 16 - 64, y + 5 + 34 - 96) of the slot origin (216, 283) and its centre lies on the centre of the slot's hit rect.
  await expect(page.locator('.cs-select')).toHaveCount(1);
  const glow = await page.locator('.cs-select').evaluate(el => { const h = el as HTMLElement; return { left: h.offsetLeft, top: h.offsetTop, width: h.offsetWidth, height: h.offsetHeight }; });
  const slot = await page.locator('.cs-slot-hit:not([hidden])').first().evaluate(el => { const h = el as HTMLElement; return { left: h.offsetLeft, top: h.offsetTop, width: h.offsetWidth, height: h.offsetHeight }; });
  expect(glow).toEqual({ left: 184, top: 226, width: 128, height: 128 });
  expect(Math.abs(glow.left + glow.width / 2 - (slot.left + slot.width / 2))).toBeLessThanOrEqual(3);
  expect(Math.abs(glow.top + glow.height / 2 - (slot.top + slot.height / 2))).toBeLessThanOrEqual(3);
  // Crear -> frmCrearPersonaje; a bad name is refused by the client with frmMensaje (ValidarNombre), no packet is sent.
  await page.getByRole('button', { name: 'Crear personaje' }).first().click();
  await expect(page.locator('#connect-stage')).toHaveAttribute('data-screen', 'create');
  await page.locator('.cs-name').fill('Ab1');
  await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
  await expect(page.locator('[id^="message-"]')).toContainText('Sólo se permiten letras y espacios.');
  await page.keyboard.press('Enter');
  expect(received.filter(p => p.id === 74)).toHaveLength(0);
  // Elfo, Mujer, then a valid name: LoginNewChar carries race 2, gender 2, class 1 (Mago), a head of the elf list, home 7. The server refuses first.
  await page.getByRole('button', { name: 'Raza siguiente' }).click(); await page.getByRole('button', { name: 'Genero siguiente' }).click();
  await page.locator('.cs-name').fill('Nuevo Pj');
  await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
  await expect(page.locator('[id^="message-"]')).toContainText('Ya existe el personaje');
  await expect(page.locator('#connect-stage')).toHaveAttribute('data-screen', 'create'); // stays on the creation screen
  const first = received.find(p => p.id === 74)!;
  const hex = first.hex; // 4a00 + String8 "Nuevo Pj" + race 02, gender 02, class 01, head varint, home 07
  expect(hex.startsWith('4a00' + '08' + Buffer.from('Nuevo Pj').toString('hex') + '020201')).toBe(true);
  expect(hex.endsWith('07')).toBe(true);
  await page.keyboard.press('Enter');
  await page.locator('.cs-create').getByRole('button', { name: 'Crear personaje' }).click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true', { timeout: 30_000 });
  await expect(page.locator('#connect-stage')).toBeHidden();
  await expect(page.locator('#character-name')).toHaveText('Mockchar');
  // The X of frmMain opens frmCerrar; Cancelar closes it, Menú principal sends Quit (39).
  await page.getByRole('button', { name: 'Leave world' }).click();
  await expect(page.locator('#exit-window')).toBeVisible();
  await page.locator('#exit-window').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('#exit-window')).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave world' }).click();
  await page.locator('#exit-window').getByRole('button', { name: 'Menú principal' }).click();
  await expect.poll(() => received.some(p => p.id === 39)).toBe(true);
  expect(failures).toEqual([]);
});
