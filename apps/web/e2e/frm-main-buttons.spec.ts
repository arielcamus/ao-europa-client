import { test, expect } from '@playwright/test';
import { readForm } from './form-reference.js';

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

// imgBugReport -> FrmGmAyuda (pinned 619e69d): ventanagm.bmp, the .frm geometry, radio-on.bmp on the chosen row, and the row -> reason map.
test('FrmGmAyuda: ventanagm.bmp, controls where the .frm puts them, the rows send the reason printed on them', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.locator('#menu-tab').click();
  await page.locator('#bug-report').click();
  const win = page.locator('#gm-help');
  await expect(win).toHaveCSS('background-image', /ventanagm\.bmp/);
  await expect(page.locator('#gm-help-send')).toHaveCSS('background-image', /boton-enviar-default\.bmp/);
  await expect(page.locator('#gm-help-cancel')).toHaveCSS('background-image', /boton-cancelar-default\.bmp/);
  const { rectangles } = await readForm('FrmGmAyuda.frm');
  const pairs: [string, string][] = [['txtMotivo', 'text'], ['cmdEnviarMensaje', 'send'], ['cmdCancelar', 'cancel'], ['cmdCerrar', 'close']];
  for (let i = 0; i < 7; i++) pairs.push([`optConsult-${i}`, `reason-${i}`]);
  const measured = await win.evaluate((root: HTMLElement, list) => {
    const frame = root.getBoundingClientRect(), scale = frame.width / root.offsetWidth, out: Record<string, number[]> = {};
    for (const [control, id] of list) { const r = document.getElementById(`gm-help-${id}`)!.getBoundingClientRect(); out[control] = [(r.x - frame.x) / scale, (r.y - frame.y) / scale, r.width / scale, r.height / scale]; }
    return { out, size: [root.offsetWidth, root.offsetHeight] };
  }, pairs);
  expect(measured.size).toEqual([470, 435]);
  for (const [control] of pairs) ['x', 'y', 'width', 'height'].forEach((field, i) => expect(Math.abs(measured.out[control]![i]! - rectangles[control]![field as 'x']), `${control}.${field}`).toBeLessThan(0.7));
  // The second row of the bitmap reads "Reportar Bug": it is optConsult(4), and its reason is optConsulta(4).Caption.
  const rows = await Promise.all(Array.from({ length: 7 }, (_, i) => page.locator(`#gm-help-reason-${i}`).boundingBox()));
  const byRow = rows.map((box, i) => [box!.y, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  expect(byRow).toEqual([0, 4, 1, 3, 6, 2, 5]);
  await page.locator('#gm-help-reason-4').click();
  await expect(page.locator('#gm-help-reason-4')).toHaveCSS('background-image', /radio-on\.bmp/);
  await expect(page.locator('#gm-help-reason-4')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#messages')).toContainText('Explique de la forma más detallada cómo repetir el error.');
  await win.screenshot({ path: 'artifacts/screenshots/window-sweep-gm-help-web.png' });
  await page.locator('#gm-help-cancel').click();
  await expect(win).toHaveCount(0);
  expect(failures).toEqual([]);
});
