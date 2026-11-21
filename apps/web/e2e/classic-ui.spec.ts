import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { readForm, referenceHTML } from './form-reference.js';
import { classicScale } from '../src/classic-layout.js';

async function checkGeometry(page: Page) {
  const expected = (await readForm()).rectangles;
  const measured = await page.locator('#classic').evaluate(root => {
    const frame = root.getBoundingClientRect(), scale = frame.width / 1024;
    return [...root.querySelectorAll<HTMLElement>('[data-vb]')]
      .filter(node => node.getBoundingClientRect().width > 0 && !node.closest('#login') && !node.classList.contains('bar'))
      .map(node => { const r = node.getBoundingClientRect(); return { control: node.dataset.vb!, x: (r.x - frame.x) / scale, y: (r.y - frame.y) / scale, width: r.width / scale, height: r.height / scale }; });
  });
  for (const actual of measured) {
    const source = expected[actual.control];
    expect(source, `original form contains ${actual.control}`).toBeDefined();
    for (const field of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual[field] - source![field]), `${actual.control}.${field}`).toBeLessThan(.08);
  }
  const frame = (await page.locator('#classic').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(frame.width).toBeCloseTo(1024 * classicScale(viewport.width, viewport.height), 2);
  expect(frame.height / frame.width).toBeCloseTo(768 / 1024, 4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return measured;
}

test('original form geometry, inventory/spells, server bars, safe chat and scaled layout', async ({ page, context }, info) => {
  const activate = async (control: Locator) => {
    await control.scrollIntoViewIfNeeded();
    if (info.project.use.hasTouch) await control.tap(); else await control.click();
  };
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('response', response => { if (response.url().includes('/ao-assets/') && !response.ok()) failures.push(response.url()); });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await expect(page.locator('#connect')).toBeEnabled();
  await activate(page.locator('#connect'));
  await expect(page.locator('#connection')).toHaveText('Connected');
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  const geometry = await checkGeometry(page);
  await expect(page.locator('.inventory-slot')).toHaveCount(42);
  await expect(page.getByRole('button', { name: 'Casilla 1: Manzana Roja × 5', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Casilla 25: Bloqueada', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#hp-text')).toHaveText('80 / 100');
  await expect(page.locator('#mana-text')).toHaveText('60 / 80');
  await activate(page.getByRole('button', { name: 'Menú', exact: true }));
  await expect(page.locator('#stats-art')).toHaveAttribute('src', /ventanaprincipal_info/);
  await expect(page.locator('#hp-text')).toBeHidden();
  await activate(page.getByRole('button', { name: 'Stats', exact: true }));
  await expect(page.locator('#hp-text')).toBeVisible();
  expect(await page.locator('#hp-fill').evaluate(node => Number.parseFloat((node as HTMLElement).style.width))).toBeCloseTo(172.8);
  await activate(page.getByRole('tab', { name: 'Hechizos', exact: true }));
  await expect(page.locator('#inventory')).toBeHidden();
  await expect(page.getByRole('option', { name: 'Dardo Mágico', exact: true })).toBeVisible();
  await activate(page.getByRole('option', { name: 'Dardo Mágico', exact: true }));
  await expect(page.getByRole('option', { name: 'Dardo Mágico', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.locator('#spells').focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator('#spell-2')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#position')).toHaveText('50, 50');
  await checkGeometry(page);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: `artifacts/screenshots/classic-spells-${info.project.name}.png`, scale: 'css' });
  await activate(page.getByRole('tab', { name: 'Inventario', exact: true }));
  await activate(page.getByRole('button', { name: 'Abrir chat', exact: true }));
  const message = '<img src=x onerror=alert(1)> Hola ñ';
  await page.locator('#chat').fill(message); await page.locator('#chat').press('Enter');
  await expect(page.locator('#messages')).toContainText(message);
  await expect(page.locator('#messages img')).toHaveCount(0);
  await expect(page.locator('#chat-form')).toBeHidden();
  await expect(page.locator('#position')).toHaveText('50, 50');
  await expect(page.locator('#error')).toBeHidden();
  if (info.project.name === 'desktop-chrome') {
    await writeFile('artifacts/screenshots/classic-form-geometry.json', JSON.stringify({ source: 'frmMain.frm, twips / 15; 1024×768 runtime backbuffer', measured: geometry }, null, 2));
    const reference = await context.newPage();
    await reference.route('**/vb6-reference', route => route.fulfill({ contentType: 'text/html', body: '' }));
    await reference.goto('/vb6-reference');
    for (const tab of ['inventory', 'spells'] as const) {
      await reference.setViewportSize({ width: 1440, height: 1000 });
      await reference.setContent(await referenceHTML(tab));
      await reference.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
      await reference.screenshot({ path: `artifacts/screenshots/vb6-reference-${tab}-desktop.png`, scale: 'css' });
      await reference.locator('#reference').screenshot({ path: `artifacts/screenshots/vb6-reference-${tab}-native.png`, scale: 'css' });
      await reference.setViewportSize({ width: 390, height: 844 });
      await reference.screenshot({ path: `artifacts/screenshots/vb6-reference-${tab}-390.png`, scale: 'css' });
    }
    await reference.close();
  }
  expect(failures).toEqual([]);
});

// frmMain panelInf: the five safe toggles are Image controls without Stretch, so each one is a single 34x34 picture at its Left/Top
// that covers the slot art baked into ventanaprincipal_info (the first three used to be drawn at 27.2 px, leaving the baked icon doubled behind).
test('safe toggles render one native-size image each over the baked slot art', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await page.getByRole('button', { name: 'Menú', exact: true }).click();
  const scale = (await page.locator('#classic').boundingBox())!.width / 1024;
  const parent = (await page.locator('#menu-actions').boundingBox())!;
  const expected = { party: 7.2, clan: 42.4, attack: 76.8, resu: 112, legion: 147.2 };
  for (const [key, left] of Object.entries(expected)) {
    const button = page.locator(`#safe-${key}`);
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.width / scale, key).toBeCloseTo(34, 1); expect(box.height / scale, key).toBeCloseTo(34, 1);
    expect((box.x - parent.x) / scale, key).toBeCloseTo(left, 1); expect((box.y - parent.y) / scale, key).toBeCloseTo(204, 1);
    // exactly one picture: one background-image url, no child images
    expect(await button.evaluate(node => [(getComputedStyle(node).backgroundImage.match(/url\(/g) ?? []).length, node.children.length])).toEqual([1, 0]);
  }
});
