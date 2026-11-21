import { test, expect } from '@playwright/test';

// VB6 frmMain: Enter/Esc/empty Enter close SendTxt and the game owns the keyboard again (no click needed).
test('chat: closing the box returns keyboard control to the game', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'keyboard flow');
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  const box = page.locator('#chat'), form = page.locator('#chat-form'), position = page.locator('#position');
  const walk = async (key: string) => {
    const before = await position.textContent();
    await page.keyboard.press(key, { delay: 120 });
    await expect(position).not.toHaveText(before!);
    await page.waitForTimeout(400);
  };
  const canvas = page.locator('#viewport canvas[tabindex]');
  await canvas.focus();

  // Enter, type, Enter (sent): move at once.
  await page.keyboard.press('Enter'); await expect(box).toBeFocused();
  await page.keyboard.type('hola'); await page.keyboard.press('Enter');
  await expect(form).toBeHidden(); await expect(page.locator('#messages')).toContainText('hola');
  await expect(canvas).toBeFocused();
  await walk('ArrowRight');
  // Enter, Enter (empty).
  await page.keyboard.press('Enter'); await expect(box).toBeFocused(); await page.keyboard.press('Enter');
  await expect(form).toBeHidden(); await expect(canvas).toBeFocused();
  await walk('ArrowDown');
  // Enter, Esc.
  await page.keyboard.press('Enter'); await expect(box).toBeFocused(); await page.keyboard.press('Escape');
  await expect(form).toBeHidden(); await expect(canvas).toBeFocused();
  await walk('ArrowLeft');
  // Two lines inside the talk interval: the second is dropped, but the box still closes (SendTxt_KeyUp hides it whatever HandleChatMsg did).
  await page.keyboard.press('Enter'); await page.keyboard.type('uno'); await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); await page.keyboard.type('dos'); await page.keyboard.press('Enter');
  await expect(form).toBeHidden(); await expect(canvas).toBeFocused();
  await page.waitForTimeout(600);
  await walk('ArrowRight');
  // While the box is open the arrows do not walk (PermitirMoverse off), they move the text cursor.
  await page.keyboard.press('Enter'); await expect(box).toBeFocused();
  const open = await position.textContent();
  await page.keyboard.press('ArrowUp', { delay: 120 }); await page.waitForTimeout(400);
  await expect(position).toHaveText(open!);
  await page.keyboard.press('Escape');
});
