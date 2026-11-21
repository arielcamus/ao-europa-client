import { test, expect } from '@playwright/test';

// The sound options (frmOpciones audio part): opened from the Opciones button, remembered in localStorage across reloads.
test('sound options open from Opciones, change the engine settings and survive a reload', async ({ page }) => {
  await page.goto('/?audiodebug');
  await expect(page.locator('#connect')).toBeEnabled();
  const dialog = page.getByRole('dialog', { name: 'Opciones de sonido' });
  await expect(dialog).toBeHidden();
  await page.locator('#settings').click();
  await page.locator('#options-tab-audio').click();
  await expect(dialog).toBeVisible();
  const music = dialog.locator('[data-audio="music-on"]'), steps = dialog.locator('[data-audio="steps-volume"]');
  await expect(music).toBeChecked();
  await music.uncheck();
  await steps.fill('-1500');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('ao.audio.settings.v1') ?? '{}'));
  expect(stored).toMatchObject({ musicEnabled: false, volSteps: -1500 });
  expect(await page.evaluate(() => (globalThis as unknown as { __aoAudio: { engine: { settings: unknown } } }).__aoAudio.engine.settings)).toMatchObject({ musicEnabled: false, volSteps: -1500 });
  await page.locator('#options-close').click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.locator('#settings').click();
  await page.locator('#options-tab-audio').click();
  await expect(dialog.locator('[data-audio="music-on"]')).not.toBeChecked();
  await expect(dialog.locator('[data-audio="steps-volume"]')).toHaveValue('-1500');
  // Master switch off disables the volume bars, like the VB6 scroll bars.
  await dialog.locator('[data-audio="all-on"]').uncheck();
  await expect(dialog.locator('[data-audio="fx-volume"]')).toBeDisabled();
});
