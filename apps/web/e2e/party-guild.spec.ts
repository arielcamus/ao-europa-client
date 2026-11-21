import { test, expect } from '@playwright/test';
import { installFakeServer } from '../../../tools/party-guild-fake-server.mjs';

// Party and guild forms against a scripted server (tools/party-guild-fake-server.mjs, not the VB6 oracle). Desktop only.
async function login(page: import('@playwright/test').Page, role: 'none' | 'member' | 'leader') {
  const fake = await installFakeServer(page, { role });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  return fake;
}
const openMenu = async (page: import('@playwright/test').Page, name: string) => {
  await page.locator('#menu-tab').click(); await page.getByRole('button', { name, exact: true }).click();
};

test('guild list, details, application and founding send the VB6 packets', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop flow');
  const fake = await login(page, 'none');
  await openMenu(page, 'Clanes');
  const list = page.locator('#frm-guild-list');
  await expect(list.locator('.vb-row')).toHaveCount(5);
  await list.locator('.vb-row').first().click();
  await list.getByRole('button', { name: 'Detalles' }).click();
  await expect(page.locator('#frm-guild-brief')).toBeVisible();
  await page.locator('#frm-guild-brief').getByRole('button', { name: 'Solicitar ingreso' }).click();
  await page.locator('#frm-guild-sol textarea').fill('Hola, soy nuevo');
  await page.locator('#frm-guild-sol').getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect.poll(() => fake.received.some(p => p.id === 36)).toBe(true);
  expect(fake.received.find(p => p.id === 36)).toMatchObject({ guild: 'Los Pibes', application: 'Hola; soy nuevo' });
  await list.getByRole('button', { name: 'Fundar clan' }).click();
  const found = page.locator('#frm-guild-details');
  await found.locator('input').fill('Clan 1'); // digits are refused like AsciiValidos
  await found.locator('select').selectOption('1');
  await found.getByRole('button', { name: 'Fundar' }).click();
  expect(fake.received.some(p => p.id === 3)).toBe(false);
  await found.locator('input').fill('Los Nuevos');
  await found.getByRole('button', { name: 'Fundar' }).click();
  await expect.poll(() => fake.received.find(p => p.id === 3)).toMatchObject({ name: 'Los Nuevos', alignment: 1 });
});

test('leader panel opens the applicant card and a click on the map closes the guild list', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop flow');
  const fake = await login(page, 'leader');
  await openMenu(page, 'Clanes');
  const panel = page.locator('#frm-guild-leader');
  await expect(panel.locator('.vb-row', { hasText: 'Dan' })).toBeVisible();
  await panel.locator('.vb-row', { hasText: 'Dan' }).dblclick();
  await expect(page.locator('#frm-char-info')).toBeVisible();
  await expect(page.locator('#frm-char-info')).toContainText('Nombre: Dan');
  await page.locator('#frm-char-info').getByRole('button', { name: 'Peticion' }).click();
  await expect(page.locator('#frm-user-request textarea')).toHaveValue('Quiero entrar al clan.\nJuego todos los dias.');
  expect(fake.received.map(p => p.id)).toEqual(expect.arrayContaining([84, 34, 25]));
});

test('group window lists the members and the invite button asks the server for a target', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop flow');
  const fake = await login(page, 'none');
  fake.state.group = ['TGuild(Líder)', 'Aotesta'];
  await openMenu(page, 'Grupo');
  const win = page.locator('#frm-grupo');
  await expect(win.locator('.vb-row')).toHaveText(['TGuild(Líder)', 'Aotesta']);
  await win.getByRole('button', { name: 'Invitar' }).click();
  await expect(win).toBeHidden();
  await expect.poll(() => fake.received.some(p => p.id === 234)).toBe(true);
  await expect(page.locator('#viewport')).toHaveAttribute('data-targeting', 'true');
});
