import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installFakeServer } from '../../../tools/party-guild-fake-server.mjs';

// Captions baked into the interface bitmaps are painted out and redrawn as live text (ui-captions.ts). Ariel, 21 Nov: "Many items in the GUI
// look pixeled/blurry" ... "The UI texts look great!".
type Match = { text: string; found: boolean; overlap: number };
type Api = { names: string[]; texts(name: string): string[]; check(file: string): Promise<Match[] | undefined>; preview(file: string, scale?: number): Promise<{ before: string; after: string } | undefined> };
const STATES = ['', '-default', '-over', '-off', '-on'];

test('every caption is found in every state of its bitmap and the live text lands on its letters', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'pixel check once, on desktop Chrome');
  test.setTimeout(240_000);
  await page.goto('/?captiondebug');
  await page.waitForFunction(() => (globalThis as { __aoCaptions?: unknown }).__aoCaptions);
  const results = await page.evaluate(async states => {
    const captions = (globalThis as unknown as { __aoCaptions: Api }).__aoCaptions, out: { file: string; matches: Match[] }[] = [];
    for (const name of captions.names) for (const state of states) {
      const matches = await captions.check(name + state);
      if (matches) out.push({ file: name + state, matches });
    }
    return out;
  }, STATES);
  const names = await page.evaluate(() => (globalThis as unknown as { __aoCaptions: Api }).__aoCaptions.names);
  const loaded = new Set(results.map(r => r.file.replace(/-(default|over|off|on)$/, '')));
  expect(names.filter(name => !loaded.has(name)), 'table entries with no bitmap').toEqual([]);
  // Every letter pixel of the original lies within 1 px of the live text and every live-text pixel within 1 px of an original letter, for at
  // least half of each (measured: all >= 0.6, median 0.99). A caption in the wrong place, size or box scores far lower.
  const bad = results.flatMap(({ file, matches }) => matches
    .filter(m => !m.found || m.overlap < 0.5)
    .map(m => `${file} "${m.text}": ${m.found ? `overlap ${m.overlap.toFixed(2)}` : 'not found'}`));
  expect(bad).toEqual([]);
  expect(results.length).toBeGreaterThan(120); // 79 bitmaps, most with default / over / off states
});

// Approximate substring match (Sellers): the smallest edit distance between `needle` and any part of `hay`.
function fuzzyIn(needle: string, hay: string): number {
  let previous = new Array(hay.length + 1).fill(0) as number[];
  for (let i = 1; i <= needle.length; i++) {
    const row = [i];
    for (let j = 1; j <= hay.length; j++) row[j] = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + (needle[i - 1] === hay[j - 1] ? 0 : 1));
    previous = row;
  }
  return Math.min(...previous);
}
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

test('every caption says what the original bitmap says, and the live text reads the same (macOS text recognition)', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome' || process.platform !== 'darwin', 'uses macOS Vision text recognition');
  test.setTimeout(600_000);
  const work = mkdtempSync(path.join(tmpdir(), 'ao-captions-'));
  const ocr = path.join(work, 'ocr');
  try { execFileSync('swiftc', ['-O', path.resolve('tools/ui-captions/ocr.swift'), '-o', ocr], { stdio: 'ignore', timeout: 240_000 }); } catch { test.skip(true, 'no Swift compiler'); }
  await page.goto('/?captiondebug');
  await page.waitForFunction(() => (globalThis as { __aoCaptions?: unknown }).__aoCaptions);
  const names = await page.evaluate(() => (globalThis as unknown as { __aoCaptions: Api }).__aoCaptions.names);
  const misses: string[] = [];
  for (const name of names) {
    // Recognition is read at two sizes (3x and 4x, nearest neighbour) and either reading counts: at 7 px a misread at one size is common.
    const shots = await page.evaluate(async name => {
      const captions = (globalThis as unknown as { __aoCaptions: Api }).__aoCaptions;
      for (const file of [name + '-default', name, name + '-on', name + '-off']) {
        const three = await captions.preview(file, 3);
        if (three) return { file, sizes: [three, (await captions.preview(file, 4))!] };
      }
      return undefined;
    }, name);
    if (!shots) { misses.push(`${name}: no bitmap`); continue; }
    const read = (which: 'before' | 'after') => shots.sizes.map((size, n) => {
      const file = path.join(work, `${which}-${n}.png`);
      writeFileSync(file, Buffer.from(size[which].split(',')[1]!, 'base64'));
      return plain(execFileSync(ocr, [file], { encoding: 'utf8' }).split('\n').map(line => line.split('\t')[1] ?? '').join(' '));
    });
    const before = read('before'), after = read('after'), shot = shots;
    const texts = await page.evaluate(name => (globalThis as unknown as { __aoCaptions: Api }).__aoCaptions.texts(name), name);
    for (const text of texts) {
      // Recognition misreads a letter or two ("rn" for "m"): a quarter of the letters of slack, at least 2. Another word does not fit in that.
      const want = plain(text), slack = Math.max(2, Math.floor(want.length * 0.25));
      if (before.every(text => fuzzyIn(want, text) > slack)) misses.push(`${shot.file} "${text}": not in the original bitmap`);
      if (after.every(text => fuzzyIn(want, text) > slack)) misses.push(`${shot.file} "${text}": the live text does not read so`);
    }
  }
  expect(misses).toEqual([]);
});

test('the frmMain buttons and the options window show live captions; ?captions=off shows the bitmaps as shipped', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const captions = () => page.locator('.ui-caption text[data-role="text"]').evaluateAll(nodes => nodes.filter(n => (n as SVGElement).getBoundingClientRect().width > 0).map(n => n.textContent));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await expect.poll(captions).toEqual(expect.arrayContaining(['AJUSTES', 'MANUAL', 'MAO', 'INVENTARIO', 'HECHIZOS', 'STATS', 'MENU']));
  await page.locator('#settings').click();
  await page.getByRole('tab', { name: 'Video' }).click();
  await expect.poll(captions).toEqual(expect.arrayContaining(['CONFIGURACIÓN', 'VIDEO', 'VISUALIZACIÓN', 'Mostrar FPS en pantalla', 'Utilizar minimapa en modo continuo']));
  // Vector text: the caption scales with the window instead of being resampled.
  expect(await page.locator('.ui-caption text[data-caption="AJUSTES"][data-role="text"]').first().getAttribute('font-family')).toContain('Cinzel');
  await page.goto('/?captions=off');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  expect(await page.locator('.ui-caption').count()).toBe(0);
});

test('every element showing a captioned picture has its caption drawn on it, in every window and button state', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop flow');
  type Audit = { id: string; drawn: string[] }[];
  const bare = () => page.evaluate(() => (globalThis as unknown as { __aoCaptions: { audit(): Audit } }).__aoCaptions.audit().filter(e => !e.drawn.length).map(e => e.id));
  const all = () => page.evaluate(() => (globalThis as unknown as { __aoCaptions: { audit(): Audit } }).__aoCaptions.audit());
  await installFakeServer(page, { role: 'none' });
  await page.goto('/?captiondebug');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await expect.poll(async () => (await all()).length).toBeGreaterThan(1);
  expect(await bare()).toEqual([]);
  // VbWindow buttons (vb-window.ts) show their pictures through --normal / --over / --off: FUNDAR CLAN, DETALLES on frmGuildLeader's list.
  await page.locator('#menu-tab').click(); await page.getByRole('button', { name: 'Clanes', exact: true }).click();
  const list = page.locator('#frm-guild-list');
  await expect(list.locator('.vb-row').first()).toBeVisible();
  const found = list.getByRole('button', { name: 'Fundar clan' });
  await expect.poll(async () => (await all()).find(e => e.id === 'Fundar clan')?.drawn).toEqual(['FUNDAR CLAN']);
  expect(await bare()).toEqual([]);
  await found.hover();
  await expect.poll(async () => (await all()).find(e => e.id === 'Fundar clan')?.drawn).toEqual(['FUNDAR CLAN']);
  expect(await bare()).toEqual([]);
  await mkdir('artifacts/screenshots', { recursive: true });
  await list.screenshot({ path: 'artifacts/screenshots/ui-captions-guild-list-hover.png' });
  await page.mouse.down();
  expect(await bare()).toEqual([]);
  await page.mouse.move(0, 0); await page.mouse.up();
  await list.locator('.vb-row').first().click();
  await list.getByRole('button', { name: 'Detalles' }).click();
  await expect(page.locator('#frm-guild-brief')).toBeVisible();
  await expect.poll(async () => (await all()).find(e => e.id === 'Solicitar ingreso')?.drawn).toEqual(['SOLICITAR INGRESO']);
  expect(await bare()).toEqual([]);
  // The options window and its tabs.
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.locator('#settings').click();
  await page.getByRole('tab', { name: 'Audio' }).click();
  await expect.poll(async () => (await all()).length).toBeGreaterThan(4);
  expect(await bare()).toEqual([]);
});
