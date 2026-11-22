import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bugReportDir } from './bug-report-dir.js';

// The in-game bug reporter (docs/BUG-REPORTS.md): F8 or the MENU tab's "Bugs" button opens it; Enviar POSTs /api/bug-report and the
// dev-web server stores <id>.json + the screenshot in AO_BUG_REPORT_DIR (playwright.config.ts points it at a temp dir of this run).
const dir = bugReportDir(Number(process.env.AO_WEB_PORT ?? 5188));

test('bug reporter: F8 opens it, Enviar stores the report with screenshot, character, logs and protocol, never the credentials', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop keyboard and layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click(); // the stand-in fills standin@local / testpass
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.evaluate(() => { console.warn('bug-report e2e marker'); });

  await page.keyboard.press('F8');
  const win = page.locator('#bug-report-window');
  await expect(win).toBeVisible();
  await expect(page.locator('#bug-report-screenshot')).toBeChecked();
  await expect(page.locator('#bug-report-thumb')).toHaveAttribute('src', /^data:image\/(png|jpeg);base64,/);
  await expect(page.locator('#bug-report-text')).toBeFocused();
  // Escape closes it like every window (window-stack.ts), and the game keys stay with the game.
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);

  await page.keyboard.press('F8');
  await page.locator('#bug-report-send').click();
  await expect(page.locator('#bug-report-status')).toHaveText('Contanos qué pasó.');
  // Typing in the box never walks or attacks: W A S D land in the text.
  await page.locator('#bug-report-text').fill('');
  await page.locator('#bug-report-text').pressSequentially('wasd ');
  await expect(page.locator('#bug-report-text')).toHaveValue('wasd ');
  await page.locator('#bug-report-text').fill('Me trabé en la puerta del banco\nsegunda línea, mi clave es testpass');
  await page.locator('#bug-report-expected').fill('Poder pasar');
  await win.screenshot({ path: 'artifacts/screenshots/bug-report-window-standin.png' });
  await page.locator('#bug-report-send').click();
  await expect(page.locator('#bug-report-status')).toContainText('¡Gracias! Reporte ');
  const id = /Reporte (\S+) enviado/.exec(await page.locator('#bug-report-status').innerText())![1]!;
  await expect(page.locator('#messages')).toContainText(`Reporte de bug enviado (${id})`);
  await expect(win).toHaveCount(0, { timeout: 5000 }); // closes itself after the thanks

  const path = join(dir, `${id}.json`);
  expect(existsSync(path), path).toBe(true);
  const raw = readFileSync(path, 'utf8');
  interface Stored {
    text: string; expected: string; phase: string; screenshotFile: string;
    character: { name: string; map: unknown; x: unknown }; client: Record<string, string>; environment: Record<string, unknown>; stats: { fps: number };
    protocol: { at: string; dir: string; id: number; name: string }[]; console: { text: string }[]; chat: unknown;
  }
  const report = JSON.parse(raw) as Stored;
  expect(report.text).toBe('Me trabé en la puerta del banco\nsegunda línea, mi clave es [redactado]');
  expect(report.expected).toBe('Poder pasar');
  expect(report.phase).toBe('playing');
  expect(report.character.name).not.toBe('');
  expect(typeof report.character.map).toBe('number');
  expect(typeof report.character.x).toBe('number');
  expect(report.client).toMatchObject({ mode: 'standin', wireProfile: 'prehoo' });
  expect(report.client.commit).toMatch(/^[0-9a-f]{7,}$/);
  expect(report.client.assetVersion).toBeTruthy();
  expect(report.environment).toMatchObject({ viewport: { width: 1440, height: 1000 } });
  expect(report.stats.fps).toBeGreaterThanOrEqual(0);
  // Protocol events are names and times: the login is there as a name, with no payload.
  const login = report.protocol.find(event => event.name === 'LoginAccount');
  expect(login).toBeDefined();
  expect(Object.keys(login!).sort()).toEqual(['at', 'dir', 'id', 'name']);
  expect(report.protocol.some(event => event.dir === 'in')).toBe(true);
  expect(report.console.some(entry => entry.text.includes('bug-report e2e marker'))).toBe(true);
  expect(Array.isArray(report.chat)).toBe(true);
  // Never the account e-mail or the password, anywhere in the stored file.
  expect(raw).not.toContain('testpass');
  expect(raw).not.toContain('standin@local');
  // The picture next to it.
  const picture = readFileSync(join(dir, report.screenshotFile));
  expect(picture.length).toBeGreaterThan(1000);
  expect(picture.length).toBeLessThan(1024 * 1024);
  const png = picture.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])), jpeg = picture[0] === 0xff && picture[1] === 0xd8;
  expect(png || jpeg).toBe(true);

  // The frmMain "Bugs" button (MENU tab) opens the same window; "Escribir a un GM" leads to the classic FrmGmAyuda.
  await page.locator('#menu-tab').click();
  await page.locator('#bug-report').click();
  await expect(win).toBeVisible();
  await page.locator('#bug-report-gm').click();
  await expect(win).toHaveCount(0);
  await expect(page.locator('#gm-help')).toBeVisible();
  expect(failures).toEqual([]);
});
