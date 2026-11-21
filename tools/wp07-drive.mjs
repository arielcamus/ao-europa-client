// AGPL-3.0-or-later. Drives the classic client in headless Chrome for the party/guild screenshots and live checks.
// Import { launch } from a scenario script:  const { page, close } = await launch({ email, password, port });
import { chromium } from '@playwright/test';
export async function launch({ email, password, port = process.env.AO_WEB_PORT ?? 5745 }) {
  if (!email || !password) throw new Error('email and password are required');
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: Number(process.env.AO_DSF ?? 1) });
  const problems = [];
  page.on('pageerror', e => problems.push(e.message)); page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); }); page.on('response', r => { if (r.status() >= 400) problems.push(r.status() + ' ' + r.url()); });
  // Frame ids in wire order, for asserting what the page sent (c2s) and received (s2c); `inject` writes a raw client frame on the page's
  // connection (e.g. the party-safe toggle, which has no UI in this package yet).
  const wire = []; let server;
  const note = dir => m => { const b = Buffer.from(typeof m === 'string' ? m : m); if (b.length >= 4) wire.push({ dir, id: b.readInt16LE(2) }); };
  await page.routeWebSocket(/bridge/, ws => {
    server = ws.connectToServer();
    ws.onMessage(m => { server.send(m); try { note('c2s')(m); } catch { /* bookkeeping only */ } });
    server.onMessage(m => { ws.send(m); try { note('s2c')(m); } catch { /* bookkeeping only */ } });
  });
  const inject = (id, body = []) => { const len = body.length + 2; server.send(Buffer.from([len & 255, len >> 8, id & 255, id >> 8, ...body])); wire.push({ dir: 'c2s', id }); };
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('#email').fill(email); await page.locator('#password').fill(password);
  await page.locator('#connect').click();
  await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }).catch(async error => {
    throw new Error(`login failed: ${await page.locator('#connection').innerText()} / ${await page.locator('#error').innerText()} ${problems.join(' | ')}`, { cause: error });
  });
  await page.waitForTimeout(1500);
  const messages = () => page.locator('#messages').innerText().then(t => t.split('\n'));
  const menu = async name => { await page.locator('#menu-tab').click(); await page.getByRole('button', { name, exact: true }).click(); };
  return { page, problems, wire, inject, messages, menu, close: () => browser.close() };
}
