import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

// Keyboard behaviour of the classic chat box against the stand-in server (desktop only).
test('chat: Enter opens, Enter sends, bubbles, remembered channel, whisper click, guild box', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'keyboard flow');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  const box = page.locator('#chat'), form = page.locator('#chat-form');
  const bubble = page.locator('.chat-bubble');

  // Enter opens the box; the VB6 box is 160 characters and keeps only characters 32..250.
  await expect(form).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(form).toBeVisible(); await expect(box).toBeFocused(); await expect(box).toHaveValue('');
  await expect(box).toHaveAttribute('maxlength', '160');
  await expect(box).toHaveCSS('background-color', 'rgb(32, 32, 32)');
  await box.fill('hola ñandú 🙂');
  await expect(box).toHaveValue('hola ñandú ');
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  await expect(bubble).toHaveCount(1); await expect(bubble).toHaveText('hola ñandú');
  await expect(bubble).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('#messages')).toContainText('[STANDIN] hola ñandú');

  // A yell is remembered: the next box starts with "-".
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter'); await box.fill('-cuidado'); await page.keyboard.press('Enter');
  await expect(bubble).toHaveText('cuidado'); await expect(bubble).toHaveCSS('color', 'rgb(255, 0, 0)');
  await page.keyboard.press('Enter'); await expect(box).toHaveValue('-'); await page.keyboard.press('Escape');
  await expect(form).toBeHidden();

  // A whisper shows "[Name] text" in the console and is remembered as "\\Name ".
  await page.keyboard.press('Enter'); await box.fill('\\STANDIN psst'); await page.keyboard.press('Enter');
  await expect(page.locator('#messages')).toContainText('[STANDIN] psst');
  await page.keyboard.press('Enter'); await expect(box).toHaveValue('\\STANDIN '); await page.keyboard.press('Escape');

  // Clicking a "[Name]" in the console starts a whisper to it.
  await page.locator('#messages > div', { hasText: '[STANDIN] hola' }).first().click();
  await expect(form).toBeVisible(); await expect(box).toHaveValue('\\STANDIN ');
  await page.keyboard.press('Escape');

  // Local failures are explained in the console and send nothing.
  await page.keyboard.press('Enter'); await box.fill('/GRUPO'); await page.keyboard.press('Enter');
  await expect(page.locator('#messages')).toContainText('Escriba un mensaje.');

  // Delete opens the guild box in its own colour; Enter sends /CMSG.
  await page.keyboard.press('Delete');
  await expect(form).toBeVisible(); await expect(box).toHaveCSS('background-color', 'rgb(64, 0, 0)');
  await box.fill('hola clan'); await page.keyboard.press('Enter');
  await expect(page.locator('#messages')).toContainText('STANDIN> hola clan');
  await expect(page.locator('#error')).toBeHidden();
  expect(failures).toEqual([]);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/feat-chat-standin.png' });
});
