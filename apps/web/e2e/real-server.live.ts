import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { FrameDecoder, decodeServerPacket, ServerPacketId } from '../../../packages/protocol/src/index.js';

test('real community server: account login, walking, 30 seconds and reconnect persistence', async ({ page, request }) => {
  const email = process.env.AO_EMAIL, password = process.env.AO_PASSWORD;
  if (!email || !password) throw new Error('Supply AO_EMAIL and AO_PASSWORD for a real local account');
  const config = await (await request.get('/ao-config.json')).json();
  expect(config).toMatchObject({ mode: 'classic', serverProfile: 'elixir-classic' });
  const failures: string[] = [];
  const receivedIds = new Set<number>();
  const experienceUpdates: number[] = [];
  page.on('websocket', socket => {
    const framing = new FrameDecoder();
    socket.on('framereceived', ({ payload }) => {
      try {
        for (const body of framing.push(Buffer.from(payload))) {
          const packet = decodeServerPacket(body);
          receivedIds.add(packet.id);
          if (!('unknown' in packet) && packet.id === ServerPacketId.UpdateExp) {
            experienceUpdates.push(packet.experience);
          }
        }
      } catch (error) { failures.push(String(error)); }
    });
  });
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/ao-assets/') && !response.ok()) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.goto('/');
  await expect(page.locator('#mode')).toHaveText('AO COMMUNITY SERVER');
  await expect(page.locator('#connect')).toBeEnabled();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Enter world' }).click();
  await expect(page.locator('#connection')).toHaveText('Connected', { timeout: 20_000 });
  await expect(page.locator('#map-name')).toHaveText('Ciudad de Ullathorpe');
  await expect(page.locator('#password')).toHaveValue('');
  await expect(page.locator('#console')).toContainText('Welcome to Argentum Online!');
  expect(experienceUpdates.length).toBeGreaterThan(0);
  const initial = (await page.locator('#position').innerText()).split(', ').map(Number);
  let [x, y] = initial as [number, number];
  let attempts = 0;
  const walk = async (step: { key?: string; dx: number; dy: number }) => {
    const before = Number(await page.locator('#confirmed').innerText());
    if (step.key) await page.keyboard.press(step.key, { delay: 80 });
    else {
      const rect = (await page.locator('#viewport').boundingBox())!;
      await page.mouse.click(rect.x + rect.width * .8, rect.y + rect.height / 2);
    }
    // A real map may block a direction. A correction must restore the old
    // position; an accepted step must match its server-authoritative delta.
    await expect.poll(async () => Number(await page.locator('#confirmed').innerText())
      + Number(await page.locator('#corrected').innerText())).toBe(++attempts);
    if (Number(await page.locator('#confirmed').innerText()) > before) {
      x += step.dx; y += step.dy;
    }
    await expect(page.locator('#position')).toHaveText(`${x}, ${y}`);
    await page.waitForTimeout(350);
  };
  const directions = [
    { key: 'ArrowRight', dx: 1, dy: 0 }, { key: 'ArrowDown', dx: 0, dy: 1 },
    { key: 'ArrowLeft', dx: -1, dy: 0 }, { key: 'ArrowUp', dx: 0, dy: -1 },
  ];
  for (const step of [...directions, { dx: 1, dy: 0 }]) await walk(step);
  // A blocked fifth step can leave the square walk at its starting tile.
  // Reconnect must prove that a CHANGED position was persisted, not just login.
  for (const step of directions) {
    if (x !== initial[0] || y !== initial[1]) break;
    await walk(step);
  }
  expect([x, y]).not.toEqual(initial);
  const confirmedWalks = Number(await page.locator('#confirmed').innerText());
  const correctedWalks = Number(await page.locator('#corrected').innerText());
  expect(confirmedWalks).toBeGreaterThan(0);
  await expect(page.locator('#duration')).toHaveText(/^(3\d|[4-9]\d) s$/, { timeout: 35_000 });
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#error')).toBeHidden();
  const finalPosition = await page.locator('#position').innerText();
  const evidence = {
    server: 'lambdaclass/argentum + classic adapter', map: await page.locator('#map-number').innerText(),
    character: await page.locator('#character-name').innerText(), initial,
    finalPosition, confirmedWalks, correctedWalks, positionChanged: true,
    duration: await page.locator('#duration').innerText(), capturedAt: new Date().toISOString(),
  };
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/classic-real-community-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#connection')).toHaveText('Connected');
  // setViewportSize can resolve before the window resize handler updates scale.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/screenshots/classic-real-community-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Leave world' }).click();
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  // Persistence completes through the server's normal logout cleanup.
  await page.waitForTimeout(1000);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Enter world' }).click();
  await expect(page.locator('#connection')).toHaveText('Connected', { timeout: 20_000 });
  await expect(page.locator('#position')).toHaveText(finalPosition);
  await expect(page.locator('#console')).toContainText('Welcome to Argentum Online!');
  expect(experienceUpdates.length).toBeGreaterThanOrEqual(2);
  await page.getByRole('button', { name: 'Leave world' }).click();
  expect(failures).toEqual([]);
  await writeFile('artifacts/screenshots/classic-real-community-proof.json', JSON.stringify({
    ...evidence, persistedOnReconnect: true, experienceUpdates,
    receivedPacketIds: [...receivedIds].sort((a, b) => a - b), failures,
  }, null, 2) + '\n');
});
