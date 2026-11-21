// AGPL-3.0-or-later. Live proof for "creatures behind a wall answer Target inválido" (Ariel, 21 Nov): ghosts left by steps out of the area.
// Headless Chrome logs a character in through our bridge, stays put while creatures step out of its 36x36 area (the server sends that
// step to the area the creature LEAVES and never a CharacterRemove; VB6 Char_Move_by_Pos erases it), then walks across the area line
// (keyboard) so the line where they left comes on screen, takes a screenshot and LeftClicks (look, non-destructive) every creature
// that left and never came back, logging what the server says is on that tile.
// Deterministic variant (AO_B_EMAIL set): a second character B (raw TCP) walks out of the web character's area by AO_B_WALK, then logs
// out (its CharacterRemove goes only to ITS area), so nothing ever corrects the stale copy; then the web character walks AO_WALK.
// Usage: AO_WEB_PORT=5825 AO_EMAIL=.. AO_PASSWORD=.. [AO_B_EMAIL=.. AO_B_PASSWORD=.. AO_B_WALK='N,N,N'] AO_WALK='N,N,N' AO_SETTLE=ms AO_TAG=before
//   node tools/area-ghost-real-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FrameDecoder, decodeServerPacket, decodeClientPacket, ClientPacketId as C } from '../packages/protocol/dist/index.js';
import { Vb6Session } from './real-server/bank-trade-session.mjs';

const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const tag = process.env.AO_TAG ?? 'run';
const dim = 12, areaOf = (x, y) => { const minX = Math.max(1, (Math.trunc(x / dim) - 1) * dim), minY = Math.max(1, (Math.trunc(y / dim) - 1) * dim); return { minX, maxX: Math.min(100, minX + 35), minY, maxY: Math.min(100, minY + 35) }; };
const outside = (a, x, y) => x < a.minX || x > a.maxX || y < a.minY || y > a.maxY;
mkdirSync('artifacts/screenshots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const chars = new Map(), left = new Map(), replies = [], sent = [];
let selfIndex, area, self;
const inbound = new FrameDecoder();
page.on('websocket', ws => {
  if (!ws.url().includes('/bridge')) return;
  ws.on('framereceived', f => {
    for (const body of inbound.push(new Uint8Array(Buffer.from(f.payload)))) {
      let p; try { p = decodeServerPacket(body); } catch { continue; }
      if (p.id === 42) { chars.set(p.charIndex, { ...p }); left.delete(p.charIndex); if (p.charIndex === selfIndex) self = { x: p.x, y: p.y }; }
      else if (p.id === 44) {
        const c = chars.get(p.charIndex); if (c) Object.assign(c, { x: p.x, y: p.y });
        if (p.charIndex === selfIndex) self = { x: p.x, y: p.y };
        else if (area && outside(area, p.x, p.y)) left.set(p.charIndex, { charIndex: p.charIndex, npc: c?.npcNumber, x: p.x, y: p.y, at: Date.now() });
        else left.delete(p.charIndex);
      } else if (p.id === 43) { chars.delete(p.charIndex); left.delete(p.charIndex); }
      else if (p.id === 47) selfIndex = p.charIndex;
      else if (p.id === 31 || p.id === 186) self = { x: p.x, y: p.y };
      else if (p.id === 57) { area = areaOf(p.x, p.y); console.log('AreaChanged', p.x, p.y, JSON.stringify(area)); }
      if (p.id === 141) replies.push({ t: Date.now(), text: `LocaleMsg ${p.messageId} ${p.text}` });
    }
  });
  ws.on('framesent', f => { const d = new FrameDecoder(); for (const b of d.push(new Uint8Array(Buffer.from(f.payload)))) { try { const p = decodeClientPacket(b); if (p.id === 78) { /* Walk */ } else if (p.id === 95) sent.push({ t: Date.now(), x: p.x, y: p.y }); } catch { /* unknown */ } } });
});
const shot = n => page.screenshot({ path: `artifacts/screenshots/area-ghost-${tag}-${n}.png`, timeout: 90_000 }).catch(e => console.log('screenshot failed', n, e.message.split('\n')[0]));
await page.goto(`http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5825}/`); await page.waitForTimeout(2500);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(1500);
await page.mouse.click(247, 290); await page.waitForTimeout(400); await page.mouse.click(685, 729); // first slot, JUGAR
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 90_000 }); await page.waitForTimeout(2000);
try {
  self ??= (() => { const c = chars.get(selfIndex); return c && { x: c.x, y: c.y }; })();
  console.log('self', selfIndex, JSON.stringify(self));
  if (process.env.AO_B_EMAIL) {
    const b = new Vb6Session({ email: process.env.AO_B_EMAIL, password: need('AO_B_PASSWORD') }); await b.login();
    const H = { N: 1, E: 2, S: 3, W: 4 };
    for (const step of (process.env.AO_B_WALK ?? 'N,N,N').split(',')) { b.send({ id: C.Walk, heading: H[step], counter: b.nextCounter('walk') }); await sleep(500); }
    b.send({ id: C.RequestPositionUpdate }); await sleep(600);
    console.log('B', b.charIndex, 'at', JSON.stringify(b.pos), 'logging out');
    await shot('b-left'); b.close(); await sleep(2500);
  }
  await sleep(Number(process.env.AO_SETTLE ?? 0));
  console.log('left the area and not back', JSON.stringify([...left.values()]));
  const keys = { N: 'ArrowUp', S: 'ArrowDown', E: 'ArrowRight', W: 'ArrowLeft' };
  { const v = await page.locator('#viewport').boundingBox(); await page.mouse.click(v.x + v.width / 2, v.y + v.height / 2); await sleep(400); } // focus the game (a look at our own tile)
  for (const step of (process.env.AO_WALK ?? '').split(',').filter(Boolean)) { await page.keyboard.down(keys[step]); await sleep(90); await page.keyboard.up(keys[step]); await sleep(450); }
  await sleep(1500);
  { const [x, y] = (await page.locator('#position').innerText()).split(',').map(Number); self = { x, y }; } // the HUD position (own steps send no CharacterMove)
  console.log('self now', JSON.stringify(self), 'area', JSON.stringify(area));
  const onScreen = [...left.values()].filter(g => Math.abs(g.x - self.x) <= 11 && Math.abs(g.y - self.y) <= 9);
  console.log('ghost candidates on screen', JSON.stringify(onScreen));
  await shot('walked');
  const vp = await page.locator('#viewport').boundingBox();
  const toPage = (tx, ty) => ({ x: vp.x + ((tx - self.x + 11) * 32 + 16) * vp.width / 736, y: vp.y + ((ty - self.y + 9) * 32 + 16) * vp.height / 608 });
  for (const g of onScreen) for (const y of [g.y, g.y - 1]) {
    const at = toPage(g.x, y), mark = replies.length, s0 = sent.length;
    await page.mouse.click(at.x, at.y); await sleep(900);
    console.log(JSON.stringify({ ghost: g.charIndex, npc: g.npc, lastServerTile: { x: g.x, y: g.y }, clickPx: { x: Math.round(at.x), y: Math.round(at.y) }, sent: sent.slice(s0), server: replies.slice(mark).map(r => r.text) }));
  }
  await shot('clicked');
} finally { await browser.close(); }
