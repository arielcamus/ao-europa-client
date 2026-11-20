// AGPL-3.0-or-later. Drives the classic web client against the real VB6 server and records its
// WebSocket frames as fixtures: tests/fixtures/vb6/chat/<scenario>.jsonl, one line per frame:
//   {"t_ms":<ms since the socket opened>,"dir":"c2s"|"s2c","id":<int>,"name":"<PacketName>","hex":"<frame body hex>"}
// It needs the dev stack running (AO_ASSETS=... AO_TCP_PORT=7667 AO_WEB_PORT=7711 node tools/dev-web.mjs --preview)
// and a character: AO_EMAIL, AO_PASSWORD, AO_URL (default http://127.0.0.1:7711/). Optional AO_SHOTS=dir for screenshots.
// The shared VB6 server can take minutes to answer while other clients are logging in, so login retries.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const url = process.env.AO_URL ?? 'http://127.0.0.1:7711/';
const email = process.env.AO_EMAIL, password = process.env.AO_PASSWORD;
if (!email || !password) throw new Error('Set AO_EMAIL and AO_PASSWORD');
const outDir = process.env.AO_FIXTURE_DIR ?? 'tests/fixtures/vb6/chat', shots = process.env.AO_SHOTS;
mkdirSync(outDir, { recursive: true }); if (shots) mkdirSync(shots, { recursive: true });
const names = { 1: 'Connected', 2: 'Logged', 3: 'RemoveDialogs', 4: 'RemoveCharDialog', 35: 'ChatOverHead', 36: 'LocaleChatOverHead', 37: 'ConsoleMsg', 38: 'ConsoleFactionMessage', 39: 'GuildChat', 42: 'CharacterCreate', 73: 'ErrorMsg', 128: 'ConsoleCharText', 141: 'LocaleMsg', 158: 'Intervals', 199: 'AccountCharacterList' };
const clientNames = { 45: 'GroupMessage', 59: 'GuildMessage', 60: 'GuildOnline', 61: 'CouncilMessage', 62: 'FactionMessage', 73: 'LoginExistingChar', 75: 'Talk', 76: 'Yell', 77: 'Whisper', 78: 'Walk', 79: 'RequestPositionUpdate', 207: 'GlobalMessage', 305: 'LoginAccount' };

const segments = { login: [] };
let current = 'login', opened = 0;
const mark = name => { current = name; segments[name] ??= []; console.log(`-- ${name}`); };
const splitters = { s2c: Buffer.alloc(0), c2s: Buffer.alloc(0) };
function capture(dir, payload) {
  let buf = Buffer.concat([splitters[dir], Buffer.from(payload)]);
  while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16LE(0)) {
    const len = buf.readUInt16LE(0), body = buf.subarray(2, 2 + len); buf = buf.subarray(2 + len);
    const id = body.readInt16LE(0);
    const name = (dir === 's2c' ? names[id] : clientNames[id]) ?? `${dir === 's2c' ? 'S' : 'C'}${id}`;
    // Never store the password: LoginAccount is recorded with the secret blanked to its length.
    let hex = body.toString('hex');
    if (dir === 'c2s' && id === 305) { const mail = Buffer.from(email); hex = Buffer.concat([body.subarray(0, 2), Buffer.from([mail.length]), mail, Buffer.from([1, 0x2a])]).toString('hex'); }
    segments[current].push({ t_ms: Date.now() - opened, dir, id, name, hex });
  }
  splitters[dir] = buf;
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', e => console.log('PAGE ERROR', e.message));
page.on('websocket', ws => {
  opened = Date.now(); splitters.s2c = Buffer.alloc(0); splitters.c2s = Buffer.alloc(0);
  ws.on('framereceived', f => capture('s2c', f.payload)); ws.on('framesent', f => capture('c2s', f.payload));
});
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/feat-chat-vb6-${name}.png` }); };

let inWorld = false;
for (let attempt = 1; attempt <= 30 && !inWorld; attempt++) {
  for (const key of Object.keys(segments)) segments[key] = [];
  current = 'login';
  await page.goto(url);
  await page.waitForFunction(() => !document.querySelector('#connect')?.disabled);
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  await page.locator('#connect').click();
  console.log(`login attempt ${attempt}`);
  inWorld = await page.waitForFunction(() => document.querySelector('#viewport')?.dataset.rendered === 'true', null, { timeout: 240000 }).then(() => true, () => false);
  if (!inWorld) console.log('  not in world:', await page.locator('#error').innerText().catch(() => ''));
}
if (!inWorld) throw new Error('could not log in');
console.log('in world');
await page.waitForTimeout(2500);
await shot('login');

const send = async text => { await page.keyboard.press('Enter'); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); };
const bubbles = () => page.locator('.chat-bubble').allInnerTexts();
const report = {};

mark('say');
await send('Hola mundo, ñandú'); await page.waitForTimeout(1200);
report.sayBubble = await bubbles(); await shot('say');
await page.waitForTimeout(2000);
await send('segundo mensaje'); await page.waitForTimeout(1200);
report.sayBubble2 = await bubbles();
await page.waitForTimeout(4500); report.afterExpiry = await bubbles();

mark('yell');
await send('-¡cuidado!'); await page.waitForTimeout(1200);
report.yellBubble = await bubbles(); await shot('yell');
await page.waitForTimeout(4500);

mark('whisper');
await send('\\TChat psst, secreto'); await page.waitForTimeout(1500);
await shot('whisper');
await send('\\NoExisteNadie hola'); await page.waitForTimeout(1500);

mark('channels');
await send('/GRUPO hola grupo'); await page.waitForTimeout(1500);
await send('/CMSG hola clan'); await page.waitForTimeout(1500);
await send('/ONLINECLAN'); await page.waitForTimeout(1500);
await send('/BMSG hola consejo'); await page.waitForTimeout(1500);
await send('/FMSG hola faccion'); await page.waitForTimeout(1500);
await send('/GLOBAL hola global'); await page.waitForTimeout(1500);
await shot('channels');

report.console = await page.locator('#messages').innerText();
console.log(JSON.stringify(report, null, 2));
for (const [name, frames] of Object.entries(segments)) {
  if (!frames.length) continue;
  writeFileSync(`${outDir}/${name}.jsonl`, frames.map(f => JSON.stringify(f)).join('\n') + '\n');
  console.log(`${name}.jsonl: ${frames.length} frames`);
}
await browser.close();
