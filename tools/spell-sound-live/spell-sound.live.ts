// AGPL-3.0-or-later. Live check of spell sounds against the REAL VB6 server (issue: "Dardo Mágico makes no noise when cast").
// A GM session (Aotest, raw TCP) walks to the mage and spawns ONE creature (/ACC, char index recorded); the mage in the browser casts the
// spell at it; the browser's s2c frames are recorded as a fixture and the audio engine's play log is printed. The creature is removed with
// a GM click + /RMATA at the end (only the char index this run spawned).
// Run: AO_WEB_PORT=5818 AO_EMAIL=.. AO_PASSWORD=.. AO_SPELL='Dardo' AO_NPC=501 npx playwright test -c tools/spell-sound-live/config.ts
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Sess, packetName } from '../playthrough/session.js';
import { DoorClientPacketId as DOOR } from '@ao/protocol';
import type { ClientPacket } from '@ao/protocol';

const need = (n: string) => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();

test('spell sound live', async ({ page }) => {
  const frames: { t_ms: number; dir: string; id: number; hex: string }[] = [];
  const t0 = Date.now();
  page.on('websocket', ws => {
    ws.on('framereceived', f => { const b = Buffer.from(f.payload as Buffer); for (let o = 0; o + 4 <= b.length;) { const len = b.readUInt16LE(o); if (len < 2 || o + 2 + len > b.length) break; frames.push({ t_ms: Date.now() - t0, dir: 's2c', id: b.readInt16LE(o + 2), hex: b.subarray(o + 2, o + 2 + len).toString('hex') }); o += 2 + len; } });
    ws.on('framesent', f => { const b = Buffer.from(f.payload as Buffer); if (b.length >= 4) frames.push({ t_ms: Date.now() - t0, dir: 'c2s', id: b.readInt16LE(2), hex: b.subarray(2).toString('hex') }); });
  });
  const problems: string[] = []; page.on('pageerror', e => problems.push(e.message));
  await page.goto('/?audiodebug');
  await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
  await page.locator('.cs-slot-hit[data-slot="1"]').dblclick();
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const map = Number(await page.locator('#map-number').innerText());
  const [px, py] = (await page.locator('#position').innerText()).split(',').map(s => Number(s.trim()));
  console.log('mage at', map, px, py);

  // Target: AO_TARGET (a creature this tool spawned earlier, still alive) or one the GM spawns now (AO_NPC, Aotest must be free).
  let gm: Sess | undefined; let mine: { charIndex: number; name: string };
  if (process.env.AO_TARGET) mine = { charIndex: Number(process.env.AO_TARGET), name: '' };
  else {
    gm = await Sess.open(); gm.isGM = true;
    await gm.loginAccount(process.env.AO_GM_EMAIL ?? 'aotest@local.test', process.env.AO_GM_PASSWORD ?? 'aotestpw1');
    const ch = gm.characters.find(c => c.name === (process.env.AO_GM_CHAR ?? 'Aotest')) ?? gm.characters[0]!;
    await gm.loginChar(ch.id, ch.name);
    gm.gm(`/TELEP YO ${map} ${px! + Number(process.env.AO_DX ?? 3)} ${py! + Number(process.env.AO_DY ?? 0)}`);
    await gm.until(() => gm!.map === map, 8000, 'GM on map'); await gm.sleep(1800);
    const m = gm.mark(); gm.gm(`/ACC ${process.env.AO_NPC ?? 602}`);
    await gm.until(() => gm!.since(m).some(r => r.name === 'CharacterCreate' && (r.packet as any).npc === 1), 6000, 'creature spawned');
    const cr = gm.since(m).filter(r => r.name === 'CharacterCreate' && (r.packet as any).npc === 1).pop()!.packet as any;
    mine = { charIndex: cr.charIndex as number, name: cr.name as string };
    console.log('SPAWNED', JSON.stringify({ ...mine, x: cr.x, y: cr.y }));
    gm.gm('/INVISIBLE'); await gm.sleep(800);
  }
  const where = () => page.evaluate((idx: number) => {
    const s = (globalThis as any).__aoAudio?.world?.session; const c = s?.tracker.chars.get(idx); const me = s?.tracker.chars.get(s.charIndex);
    return { c: c ? { x: c.x, y: c.y } : undefined, me: me ? { x: me.x, y: me.y } : undefined };
  }, mine.charIndex);

  const shots = 'artifacts/screenshots'; mkdirSync(shots, { recursive: true });
  try {
    // AO_WALK="U7,R2": arrow presses to get in range of a fixed target (a training dummy) first
    for (const step of (process.env.AO_WALK ?? '').split(',').filter(Boolean)) {
      const key = { U: 'ArrowUp', D: 'ArrowDown', L: 'ArrowLeft', R: 'ArrowRight' }[step[0]!]!;
      for (let n = 0; n < Number(step.slice(1) || 1); n++) { await page.keyboard.press(key); await page.waitForTimeout(350); }
    }
    console.log('after walk', JSON.stringify(await where()));
    await page.locator('#spells-tab').click();
    const rows = await page.locator('#spells .spell').allInnerTexts();
    const want = process.env.AO_SPELL ?? 'Dardo';
    const idx = rows.findIndex(r => r.includes(want));
    console.log('spells', JSON.stringify(rows.slice(0, 6)), 'using', idx + 1);
    const casts = Number(process.env.AO_CASTS ?? 2);
    for (let i = 0; i < casts; i++) {
      let w = await where(); if (!w.c || !w.me) { console.log('creature gone', JSON.stringify(w)); break; }
      await page.locator(`#spell-${idx + 1}`).click();
      await page.locator('#cast').click(); await page.waitForTimeout(250);
      w = await where(); if (!w.c || !w.me) break;
      const geo = await page.evaluate(() => { const v = document.querySelector('#viewport')!; const r = v.getBoundingClientRect(); const cv = v.querySelector('canvas') as HTMLCanvasElement; return { x: r.x, y: r.y, w: r.width, h: r.height, cw: cv.width / (window.devicePixelRatio || 1) }; });
      const s = geo.w / geo.cw;
      console.log('cast', i + 1, 'me', JSON.stringify(w.me), 'target', JSON.stringify(w.c));
      await page.mouse.click(geo.x + geo.w / 2 + (w.c.x - w.me.x) * 32 * s, geo.y + geo.h / 2 + (w.c.y - 1 - w.me.y) * 32 * s); // LookatTile looks at the tile SOUTH of the click first: click the tile above the target
      await page.waitForTimeout(400);
      if (i === 0) await page.screenshot({ path: `${shots}/spell-sound-cast.png` });
      await page.waitForTimeout(1800);
    }
    const audio = await page.evaluate(() => { const a = (globalThis as any).__aoAudio; return { unlocked: a?.engine?.isUnlocked, events: a?.engine?.events?.filter((e: any) => e.kind === 'wave' && e.category !== 'steps') }; });
    console.log('AUDIO', JSON.stringify(audio));
    console.log('MESSAGES', JSON.stringify((await page.locator('#messages').innerText()).split('\n').slice(-8)));
  } finally {
    if (gm) {
      const c = gm.chars.get(mine.charIndex), w = await where();
      if (c && c.name === mine.name && w.c) {
        gm.gm('/INVISIBLE'); await gm.sleep(500);
        gm.send({ id: DOOR.LeftClick, x: w.c.x, y: w.c.y - 1, counter: 0 } as ClientPacket); // LookatTile checks the tile south of the click first await gm.sleep(700);
        gm.gm('/RMATA'); await gm.sleep(1500);
        console.log('REMOVED?', mine.charIndex, 'CharacterRemove seen:', gm.rx.some(r => r.name === 'CharacterRemove' && (r.packet as any).charIndex === mine.charIndex));
      }
      gm.say('/SALIR'); await gm.sleep(1500); gm.close();
    }
    console.log('target still in view:', JSON.stringify((await where()).c));
    const out = process.env.AO_FIXTURE; // docs/CONFORMANCE.md format; LoginAccount / CreateAccount bodies are redacted to the id
    if (out) writeFileSync(out, frames.map(f => JSON.stringify({ t_ms: f.t_ms, dir: f.dir, id: f.id, name: packetName(f.dir === 's2c' ? 's' : 'c', f.id), hex: f.dir === 'c2s' && (f.id === 304 || f.id === 305) ? f.hex.slice(0, 4) : f.hex })).join('\n') + '\n');
    console.log('problems', JSON.stringify(problems.slice(0, 5)));
  }
});

/** Removes ONE creature this tool spawned earlier (AO_CLEANUP=<charIndex>, AO_MAP, AO_X, AO_Y near it): the GM clicks its current tile with no
 *  character south of it (LookatTile prefers the one below) and sends /RMATA; done when the CharacterRemove for that index arrives. */
test('cleanup', async () => {
  test.skip(!process.env.AO_CLEANUP, 'AO_CLEANUP not set');
  const target = Number(process.env.AO_CLEANUP);
  const gm = await Sess.open(); gm.isGM = true;
  await gm.loginAccount(process.env.AO_GM_EMAIL ?? 'aotest@local.test', process.env.AO_GM_PASSWORD ?? 'aotestpw1');
  const ch = gm.characters.find(c => c.name === (process.env.AO_GM_CHAR ?? 'Aotest')) ?? gm.characters[0]!;
  try { await gm.loginChar(ch.id, ch.name); } catch (e) { console.log('login failed', JSON.stringify(gm.rx.slice(-8).map(r => [r.name, JSON.stringify(r.packet).slice(0, 120)])), gm.characters.map(c => c.name)); throw e; }
  gm.gm(`/TELEP YO ${need('AO_MAP')} ${need('AO_X')} ${need('AO_Y')}`); await gm.sleep(2500);
  const c = gm.chars.get(target);
  console.log('creature seen', JSON.stringify(c && { x: c.x, y: c.y, body: c.body, npc: (c as any).npc }));
  if (c && (c as any).npc === 1) {
    for (let i = 0; i < 4 && !gm.rx.some(r => r.name === 'CharacterRemove' && (r.packet as any).charIndex === target); i++) {
      const cur = gm.chars.get(target)!;
      gm.send({ id: DOOR.LeftClick, x: cur.x, y: cur.y, counter: 0 } as ClientPacket); await gm.sleep(700);
      console.log('look:', JSON.stringify(gm.localeSince(gm.rx.length - 6)));
      gm.gm('/RMATA'); await gm.sleep(1500);
    }
  }
  console.log('removed:', gm.rx.some(r => r.name === 'CharacterRemove' && (r.packet as any).charIndex === target));
  gm.say('/SALIR'); await gm.sleep(1500); gm.close();
});
