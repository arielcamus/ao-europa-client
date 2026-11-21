// AGPL-3.0-or-later. Live probe: look at / cast at creatures standing behind a wall (Newbie Dungeon, map 37: the merchant room's north
// wall) with the real web client through our bridge. Non-destructive: LeftClick (look) and the HEAL spell (Curar heridas leves, Target=3
// like Dardo Mágico, so the same LanzarHechizo target branch and the same Msg792), so no creature we did not spawn is hurt. Logs the click
// pixel, the tile the page sends (LeftClick / WorkLeftClick), the creature's tile from CharacterCreate/Move and the server's answer.
// Usage: AO_WEB_PORT=5825 AO_EMAIL=.. AO_PASSWORD=.. AO_CHAR=Name [AO_KINDS=look,cast] [AO_SETTLE=ms] [AO_MAX=n] node tools/spell-wall-real-shot.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { FrameDecoder, decodeServerPacket, decodeClientPacket, } from '../packages/protocol/dist/index.js';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const base = `http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5825}/`;
const charName = need('AO_CHAR');
const spellSlot = Number(process.env.AO_SLOT ?? 2);           // Curar heridas leves (Target=3, like Dardo Mágico)
mkdirSync('artifacts/screenshots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const problems = [], events = [], chars = new Map();
let self, selfIndex;
const inbound = new FrameDecoder();
page.on('pageerror', e => problems.push(e.message));
page.on('websocket', ws => { if (!ws.url().includes('/bridge')) return;
  ws.on('framereceived', f => {
    for (const body of inbound.push(new Uint8Array(Buffer.from(f.payload)))) {
      let p; try { p = decodeServerPacket(body); } catch { continue; }
      if (p.name === 'CharacterCreate' || p.id === 42) chars.set(p.charIndex, { ...p });
      else if (p.id === 44 || p.id === 187) { const c = chars.get(p.charIndex); if (c) Object.assign(c, { x: p.x, y: p.y }); }
      else if (p.id === 43) chars.delete(p.charIndex); // CharacterRemove
      if (p.id === 47) selfIndex = p.charIndex;
      if ([141, 37, 62].includes(p.id) || /Damage|Fx|Spell/i.test(p.name ?? '')) events.push({ t: Date.now(), dir: 's2c', p });
    }
  });
  ws.on('framesent', f => {
    const b = new Uint8Array(Buffer.from(f.payload));
    const d = new FrameDecoder();
    for (const body of d.push(b)) { let p; try { p = decodeClientPacket(body); } catch { continue; } if ([2, 94, 95].includes(p.id)) events.push({ t: Date.now(), dir: 'c2s', p }); }
  });
});
const shot = n => page.screenshot({ path: `artifacts/screenshots/spell-wall-${n}.png` });
await page.goto(base); await page.waitForTimeout(2500);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 30_000 }); await page.waitForTimeout(1500);
await page.mouse.click(247, 290); await page.waitForTimeout(400); await page.mouse.click(685, 729); // the first slot, then JUGAR
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 90_000 }); await page.waitForTimeout(3000);

const selfChar = () => chars.get(selfIndex);
const s = selfChar();
const vp = await page.locator('#viewport').boundingBox();
// tileAt inverse at rest: tile (tx, ty) covers viewport px [(tx - x + 11) * 32, +32) x [(ty - y + 9) * 32, +32).
const toPage = (tx, ty, ox = 16, oy = 16) => ({ x: vp.x + ((tx - s.x + 11) * 32 + ox) * vp.width / 736, y: vp.y + ((ty - s.y + 9) * 32 + oy) * vp.height / 608 });
const npcs = () => [...chars.values()].filter(c => c.charIndex !== selfIndex && Math.abs(c.x - s.x) <= 11 && Math.abs(c.y - s.y) <= 9).map(c => ({ ci: c.charIndex, n: c.npcNumber, body: c.body, x: c.x, y: c.y, name: c.name }));
console.log('self', selfIndex, s.x, s.y, 'on screen', JSON.stringify(npcs()));
await shot('before');
// Non-destructive probes only: LeftClick (look, LookatTile) and the HEAL spell (slot AO_SLOT, Target=3 like Dardo: same
// LanzarHechizo target branch and the same Msg792 when LookatTile found nobody), so no creature we did not spawn is hurt.
const probe = async (label, tile, kind, dy = 0, oy = 16) => {
  if (kind === 'cast') {
    await sleep(1800); // the client's own CastSpell interval
    if (!(await page.locator('#spells').isVisible())) await page.getByRole('tab', { name: 'Hechizos', exact: true }).click();
    await page.locator('#spells .spell').nth(spellSlot - 1).click();
    const asked = events.length; await page.locator('#cast').click();
    for (let i = 0; i < 20 && !events.slice(asked).some(e => e.p.id === 62); i++) await sleep(50); // WorkRequestTarget
  }
  const c = tile(), at = toPage(c.x, c.y + dy, 16, oy), mark = events.length;
  await page.mouse.click(at.x, at.y); await sleep(900);
  const sent = events.slice(mark).filter(e => e.dir === 'c2s' && (e.p.id === 2 || e.p.id === 95)).map(e => ({ id: e.p.id === 2 ? 'WorkLeftClick' : 'LeftClick', x: e.p.x, y: e.p.y }));
  const replies = events.slice(mark).filter(e => e.dir === 's2c' && e.p.id !== 62).map(e => e.p.id === 141 ? `LocaleMsg ${e.p.messageId} ${e.p.text}` : e.p.id === 37 ? `Console ${e.p.text ?? ''}` : `${e.p.id}`);
  const after = tile();
  console.log(JSON.stringify({ label, kind, creatureAtClick: { x: c.x, y: c.y }, creatureAfter: { x: after.x, y: after.y }, clickPx: { x: Math.round(at.x), y: Math.round(at.y) }, sent, replies }));
};
await sleep(Number(process.env.AO_SETTLE ?? 0)); console.log('after settle', JSON.stringify(npcs())); await shot('settled');
const targets = npcs().filter(n => n.y < s.y - 2).slice(0, Number(process.env.AO_MAX ?? 3));
for (const t of targets) {
  const tile = () => chars.get(t.ci) ?? t;
  for (const kind of (process.env.AO_KINDS ?? 'look,cast').split(',')) for (const [dy, oy] of [[0, 16], [-1, 16], [0, 30], [-1, 2]]) await probe(`ci${t.ci}_n${t.n}_dy${dy}_oy${oy}`, tile, kind, dy, oy);
}
await shot('after');
console.log(JSON.stringify({ problems }));
await browser.close();
