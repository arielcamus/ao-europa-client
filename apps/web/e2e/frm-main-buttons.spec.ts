import { test, expect } from '@playwright/test';

// frmMain buttons added by WP-A (pinned classic client 619e69d): the experience read-out buttons, imgManual / imgMAO and the settings button.
test('experience read-out buttons show exactly one label; the manual and MAO buttons ask before leaving', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  const labels = ['experience-text', 'exp-percent', 'exp-percent4', 'exp-remaining'];
  const visible = async () => (await Promise.all(labels.map(id => page.locator(`#${id}`).isVisible()))).map((v, i) => (v ? labels[i] : '')).filter(Boolean);
  expect(await visible()).toEqual(['experience-text']); // exp is the only label visible at design time
  for (const [button, label] of [['btn-exp', 'exp-percent'], ['btn-exp2', 'exp-percent4'], ['btn-exp-remaining', 'exp-remaining'], ['btn-exp-total', 'experience-text']] as const) {
    await page.locator(`#${button}`).click();
    expect(await visible()).toEqual([label]);
  }
  // imgManual_Click / imgMAO_Click: a MsgBox first, and the page opens only after "Sí".
  for (const [button, url] of [['manual', 'https://www.argentumonline.com.ar/wiki'], ['mao', 'https://www.argentumonline.com.ar/mercadoao']] as const) {
    await page.locator(`#${button}`).click();
    await expect(page.getByText('Deseas abrir el navegador ahora.')).toBeVisible();
    const popup = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Sí' }).click();
    expect((await popup).url()).toBe(url);
    await (await popup).close();
  }
  // The settings button no longer prints the old help lines.
  await page.locator('#settings').click();
  await expect(page.getByRole('dialog', { name: 'Opciones', exact: true })).toBeVisible();
  await expect(page.locator('#messages')).not.toContainText('Flechas / WASD');
  expect(failures).toEqual([]);
});
