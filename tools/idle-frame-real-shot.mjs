// AGPL-3.0-or-later. Headless Chrome against the REAL VB6 server: does a creature that stops next to the player hold one frame, and which one?
// Spawns ONE hostile wolf (GM /ACC 500, Lobo, body 4372, max hit 15), lets it reach the GM (made attackable with /IGNORADO) and attack ONCE,
// toggles /IGNORADO back at once (the GM has 20 HP), samples the wolf's tile while it stands there, turns the player in place by walking into it, then removes exactly that wolf
// (LeftClick on its current tile + /RMATA) and checks its CharacterRemove.
// Usage: AO_WEB_PORT=5821 AO_EMAIL=... AO_PASSWORD=... [SPAWN=1] node tools/idle-frame-real-shot.mjs   (without SPAWN it only logs in and prints the position)
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const need = n => process.env[n] ?? (() => { throw new Error(`Set ${n}`); })();
const WOLF_NPC = 500, WOLF_BODY = 4372;
let attackable = false;
const out = 'artifacts/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 });
const t0 = Date.now(), log = [], wolf = { charIndex: 0, x: 0, y: 0, heading: 0, removed: false };
const note = line => { const s = `${((Date.now() - t0) / 1000).toFixed(2)}s ${line}`; log.push(s); console.log(s); };
// A WebSocket message can carry several frames ([uint16 length][int16 id][body]): walk them all.
const frames = payload => { const b = Buffer.from(payload), out = []; for (let o = 0; o + 4 <= b.length;) { const n = b.readUInt16LE(o); out.push(b.subarray(o, o + 2 + n)); o += 2 + n; } return out; };
page.on('websocket', ws => ws.on('framereceived', f => { for (const b of frames(f.payload)) {
  const id = b.readInt16LE(2);
  if (id === 42 && b.length > 12 && b.readInt16LE(6) === WOLF_BODY && !wolf.charIndex) {
    Object.assign(wolf, { charIndex: b.readInt16LE(4), heading: b[10], x: b[11], y: b[12] }); note(`CharacterCreate wolf charIndex=${wolf.charIndex} at ${wolf.x},${wolf.y} heading ${wolf.heading}`);
  } else if (wolf.charIndex && b.length > 5 && b.readInt16LE(4) === wolf.charIndex) {
    if (id === 44) { wolf.x = b[6]; wolf.y = b[7]; note(`CharacterMove wolf -> ${wolf.x},${wolf.y}`); }
    else if (id === 49) { if (b[11] !== wolf.heading) note(`CharacterChange wolf flags=${b[6]} heading ${wolf.heading} -> ${b[11]}`); wolf.heading = b[11]; }
    else if (id === 43) { wolf.removed = true; note('CharacterRemove wolf'); }
    else if (id === 182) note(`CharAtaca wolf -> victim ${b.readInt16LE(6)} damage ${b.readInt32LE(8)}`);
  }
} }));
const sleep = ms => page.waitForTimeout(ms);
const say = async text => { await page.keyboard.press('Enter'); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); await sleep(400); };
await page.goto(`http://127.0.0.1:${process.env.AO_WEB_PORT ?? 5821}/`);
await page.locator('#email').fill(need('AO_EMAIL')); await page.locator('#password').fill(need('AO_PASSWORD')); await page.locator('#connect').click();
await page.locator('.cs-slot-hit[data-slot="1"]').dblclick();
await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 30_000 }).catch(async error => {
  await page.screenshot({ path: `${out}/idle-frame-login-failed.png` }); await browser.close(); throw error;
});
await sleep(2500);
const where = async () => {
  const [map, pos] = [await page.locator('#map-number').innerText(), await page.locator('#position').innerText()];
  const m = pos.match(/(\d+)\D+(\d+)/); return { map: map.trim(), x: Number(m?.[1]), y: Number(m?.[2]) };
};
const me = await where(); note(`me map ${me.map} at ${me.x},${me.y}, hp ${await page.locator('#hp-text').innerText()}`);
// Screen pixel of a map tile's centre: the inverse of Renderer.tileAt (the camera centres the player's tile).
const tilePoint = async (x, y) => page.evaluate(([x, y, px, py]) => {
  const canvas = document.querySelector('#viewport canvas'); const r = canvas.getBoundingClientRect();
  return { x: r.left + r.width / 2 + (x - px) * 32 * (r.width / canvas.clientWidth), y: r.top + r.height / 2 + (y - py) * 32 * (r.height / canvas.clientHeight) };
}, [x, y, me.x, me.y]);
const clipAround = async (x, y, w = 3, h = 3) => { const c = await tilePoint(x, y); return { x: c.x - 16 - 32 * Math.floor(w / 2), y: c.y - 16 - 32 * (h - 1), width: 32 * w, height: 32 * (h + 0) }; };
if (process.env.SPAWN === '1') {
  try {
    await say('/IGNORADO'); attackable = true; note('GM attackable (/IGNORADO)');
    await say(`/ACC ${WOLF_NPC}`);
    for (let i = 0; i < 20 && !wolf.charIndex; i++) await sleep(250);
    if (!wolf.charIndex) throw new Error('wolf not spawned');
    await page.screenshot({ path: `${out}/idle-frame-spawn.png` });
    // Wait until it stands next to the player (Manhattan 1) and has attacked.
    for (let i = 0; i < 80; i++) { if (log.some(l => l.includes('CharAtaca'))) break; await sleep(100); }
    await say('/IGNORADO'); attackable = false; note('GM back to not attackable after the first attack (/IGNORADO)');
    await page.screenshot({ path: `${out}/idle-frame-attacked.png` });
    note(`wolf now at ${wolf.x},${wolf.y} heading ${wolf.heading}, hp ${await page.locator('#hp-text').innerText()}`);
    // Ten samples 120 ms apart of the wolf's tiles: identical crops = one held frame (a running cycle would change every ~32 ms frame).
    const samples = [];
    for (let i = 0; i < 10; i++) { const clip = await clipAround(wolf.x, wolf.y, 4, 3); samples.push((await page.screenshot({ clip })).toString('base64')); await sleep(120); }
    note(`wolf crop samples: ${new Set(samples).size} distinct of ${samples.length}`);
    writeFileSync(`${out}/idle-frame-wolf-held.png`, Buffer.from(samples.at(-1), 'base64'));
    await page.screenshot({ path: `${out}/idle-frame-wolf-adjacent.png` });
    // Turn in place: a step into the wolf is blocked (LegalPos), so the client only sends ChangeHeading (General.MoveTo).
    const dx = wolf.x - me.x, dy = wolf.y - me.y;
    const key = dx > 0 ? 'ArrowRight' : dx < 0 ? 'ArrowLeft' : dy > 0 ? 'ArrowDown' : 'ArrowUp';
    await page.locator('#viewport').click({ position: { x: 5, y: 5 }, trial: true }).catch(() => {});
    if (Math.abs(dx) + Math.abs(dy) !== 1) throw new Error(`wolf not adjacent (${wolf.x},${wolf.y}): no turn, the arrow would walk`);
    await page.keyboard.press(key); await sleep(600);
    note(`turned with ${key}, position now ${JSON.stringify(await where())}`);
    const selfSamples = [];
    for (let i = 0; i < 5; i++) { const clip = await clipAround(me.x, me.y, 3, 3); selfSamples.push((await page.screenshot({ clip })).toString('base64')); await sleep(120); }
    note(`self crop samples after the turn: ${new Set(selfSamples).size} distinct of ${selfSamples.length}`);
    writeFileSync(`${out}/idle-frame-self-turned.png`, Buffer.from(selfSamples.at(-1), 'base64'));
    await page.screenshot({ path: `${out}/idle-frame-turned.png` });
  } finally {
    // Remove exactly this wolf: select its current tile, then /RMATA; retry while it is still there.
    for (let i = 0; i < 4 && wolf.charIndex && !wolf.removed; i++) {
      const p = await tilePoint(wolf.x, wolf.y); await page.mouse.click(p.x, p.y); await sleep(600);
      await say('/RMATA'); await sleep(900);
    }
    note(`wolf ${wolf.charIndex} removed: ${wolf.removed}`);
    if (attackable) { await say('/IGNORADO'); note('GM back to not attackable (/IGNORADO)'); }
    note(`hp ${await page.locator('#hp-text').innerText()}`);
    await sleep(800);
  }
}
writeFileSync(`${out}/idle-frame-log.txt`, log.join('\n') + '\n');
await browser.close();
