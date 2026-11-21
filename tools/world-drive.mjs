// AGPL-3.0-or-later. Headless Chrome driver for the world package (map, minimap, fx, audio) against the real VB6 server.
// const { page, wire, say, close } = await launch({ email, password, port });  Logs in, double-clicks the first character slot.
import { chromium } from '@playwright/test';
export async function launch({ email, password, port = process.env.AO_WEB_PORT ?? 5785, viewport = { width: 1024, height: 768 }, slot = [247, 291] }) {
  if (!email || !password) throw new Error('email and password are required');
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport });
  const problems = [], wire = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('websocket', ws => {
    ws.on('framereceived', f => { const b = Buffer.from(f.payload); if (b.length >= 4) wire.push({ dir: 's2c', id: b.readUInt16LE(2), hex: b.subarray(2).toString('hex') }); });
    ws.on('framesent', f => { const b = Buffer.from(f.payload); if (b.length >= 4) wire.push({ dir: 'c2s', id: b.readUInt16LE(2), hex: b.subarray(2).toString('hex') }); });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#email').fill(email); await page.locator('#password').fill(password); await page.locator('#connect').click();
  await page.locator('#connect-stage[data-screen="account"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await page.mouse.click(slot[0], slot[1]); await page.waitForTimeout(500); await page.mouse.click(686, 729);
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  const say = async text => { await page.locator('#chat-open').click(); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(1200); };
  return { page, problems, wire, say, close: () => browser.close() };
}
