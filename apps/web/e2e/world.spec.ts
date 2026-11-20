import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('local artwork, login, 30 seconds connected, four directions and touch controls', async ({ page }, info) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.url().includes('/ao-assets/') && !response.ok()) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto('/');
  await expect(page.locator('#mode')).toHaveText('TEST STAND-IN');
  const enter = page.getByRole('button', { name: 'Enter world' });
  await expect(enter).toBeEnabled();
  await enter.scrollIntoViewIfNeeded();
  if (info.project.use.hasTouch) await enter.tap(); else await enter.click();
  await expect(page.locator('#connection')).toHaveText('Connected', { timeout: 20_000 });
  await expect(page.locator('#map-name')).toHaveText('Ciudad de Ullathorpe');
  await expect(page.locator('#position')).toHaveText('50, 50');
  await expect(page.locator('#password')).toHaveValue('');
  if (info.project.name === 'desktop-chrome') {
    for (const [key, position] of [['ArrowRight', '51, 50'], ['ArrowDown', '51, 51'], ['ArrowLeft', '50, 51'], ['ArrowUp', '50, 50']]) {
      await page.keyboard.press(key!, { delay: 100 });
      await expect(page.locator('#position')).toHaveText(position!);
      await page.waitForTimeout(350);
    }
  } else {
    for (const [direction, position] of [['east', '51, 50'], ['south', '51, 51'], ['west', '50, 51'], ['north', '50, 50']]) {
      const rect = (await page.locator('#viewport').boundingBox())!;
      const x = rect.x + rect.width * (direction === 'east' ? .8 : direction === 'west' ? .2 : .5);
      const y = rect.y + rect.height * (direction === 'south' ? .8 : direction === 'north' ? .2 : .5);
      await page.touchscreen.tap(x, y);
      await expect(page.locator('#position')).toHaveText(position!);
      await page.waitForTimeout(350);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await expect(page.locator('#confirmed')).toHaveText('4');
  await expect(page.locator('#corrected')).toHaveText('0');
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#duration')).toHaveText(/^(3\d|[4-9]\d) s$/, { timeout: 35_000 });
  await expect(page.locator('#connection')).toHaveText('Connected');
  await page.evaluate(() => window.scrollTo(0, 0));
  await mkdir('artifacts/screenshots', { recursive: true });
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.screenshot({ path: `artifacts/screenshots/classic-${info.project.name}.png`, fullPage: true, scale: 'css' });
  expect(failures).toEqual([]);
  if (info.project.name === 'desktop-chrome') {
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => Number(await page.locator('#confirmed').textContent())).toBeGreaterThanOrEqual(6);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(150);
    const stoppedPosition = await page.locator('#position').textContent();
    await page.waitForTimeout(700);
    await expect(page.locator('#position')).toHaveText(stoppedPosition!);
    await expect(page.locator('#connection')).toHaveText('Connected');
    await expect(page.locator('#error')).toBeHidden();
  } else {
    await page.setViewportSize({ width: 844, height: 390 });
    const rect = (await page.locator('#viewport').boundingBox())!;
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height * .8);
    await expect(page.locator('#position')).toHaveText('50, 51');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const leave = page.getByRole('button', { name: 'Leave world' });
  if (info.project.use.hasTouch) await leave.tap(); else await leave.click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#chat-form')).toBeHidden();
  // A new connection starts with clean counters, fresh placement and a new map load.
  await page.locator('#password').fill('testpass');
  if (info.project.use.hasTouch) await enter.tap(); else await enter.click();
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#position')).toHaveText('50, 50');
  await expect(page.locator('#confirmed')).toHaveText('0');
  await expect(page.locator('#error')).toBeHidden();
});

test('bad credentials are visible and local asset mount does not expose other files', async ({ page, request }, info) => {
  await page.goto('/');
  await expect(page.locator('#connect')).toBeEnabled();
  await page.locator('#password').fill('wrong');
  const enter = page.getByRole('button', { name: 'Enter world' });
  await enter.scrollIntoViewIfNeeded();
  if (info.project.use.hasTouch) await enter.tap(); else await enter.click();
  await expect(page.getByRole('alert')).toContainText('Invalid stand-in credentials');
  await expect(page.locator('#connect')).toBeEnabled();
  const artwork = await request.get('/ao-assets/interface/es_ventanaprincipal.bmp');
  expect(artwork.status()).toBe(200); expect(artwork.headers()['content-type']).toBe('image/bmp');
  for (const path of ['/ao-assets/%2e%2e%2flicense.txt', '/ao-assets/.git/config', '/ao-assets/init/Server.ini', '/ao-assets/Dat/Users.dat', '/ao-assets/interface/%2e%2e%2fDat/Users.dat']) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
