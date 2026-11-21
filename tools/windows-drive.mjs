// AGPL-3.0-or-later. Drives the classic client in headless Chrome for the windows work package (alchemy, tailor, station, guild forms).
// Usage: AO_WEB_PORT=5782 AO_EMAIL=.. AO_PASSWORD=.. [AO_CHAR=Name] node tools/windows-drive.mjs <scenario.mjs>
// A scenario is `export default async ({ page, say, shot, ... }) => {}`; see the helpers returned by `open()`.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function open({ email, password, character, port = process.env.AO_WEB_PORT ?? 5782, headless = true } = {}) {
  const browser = await chromium.launch({ channel: 'chrome', headless, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch({ headless }));
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const problems = [];
  page.on('pageerror', e => problems.push(e.message)); page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  // A character the server still believes online (a recorder or a browser that just closed) is refused: retry the whole login a few times.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.locator('#email').fill(email); await page.locator('#password').fill(password);
    await page.locator('#connect').click();
    await page.waitForTimeout(1500);
    const entered = await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 4000 }).then(() => true).catch(() => false);
    if (entered || !character) { if (!entered) { console.log('account screen: no direct login'); await page.screenshot({ path: 'artifacts/screenshots/windows-account.png' }); } break; }
    await page.locator(`.cs-slot-hit[aria-label="${character}"]`).click().catch(() => {}); await page.waitForTimeout(500);
    await page.mouse.click(685, 729); // JUGAR
    const ok = await page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 25_000 }).then(() => true).catch(() => false);
    if (ok) break;
    if (attempt === 4) { await page.screenshot({ path: 'artifacts/screenshots/windows-enter-failed.png' }); throw new Error(`could not enter as ${character}`); }
    await page.waitForTimeout(12_000);
  }
  mkdirSync('artifacts/screenshots', { recursive: true });
  return {
    browser, page, problems,
    ready: () => page.locator('#viewport[data-rendered="true"]').waitFor({ timeout: 60_000 }),
    shot: name => page.screenshot({ path: `artifacts/screenshots/windows-${name}.png` }),
    messages: async (n = 8) => (await page.locator('#messages').innerText()).split('\n').slice(-n),
    /** Types a line into the chat box like the player (Enter, text, Enter): slash commands included. */
    say: async text => { await page.locator('#viewport').click({ position: { x: 5, y: 5 } }).catch(() => {}); await page.keyboard.press('Enter'); await page.locator('#chat').fill(text); await page.keyboard.press('Enter'); await page.waitForTimeout(900); },
    slot: n => page.locator('#inventory button').nth(n - 1),
  };
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scenario = (await import(pathToFileURL(path.resolve(process.argv[2])).href)).default;
  const env = k => process.env[k] ?? (() => { throw new Error(`Set ${k}`); })();
  const h = await open({ email: env('AO_EMAIL'), password: env('AO_PASSWORD'), character: process.env.AO_CHAR });
  try { await scenario(h); } finally { console.log(JSON.stringify({ problems: h.problems.slice(0, 10) })); await h.browser.close(); }
}
