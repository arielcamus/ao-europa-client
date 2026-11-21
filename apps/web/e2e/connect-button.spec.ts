import { test, expect } from '@playwright/test';

// FrmLogear.cmdIngresar: Left 2750 twips = 183.3 px, Top 2055 = 137 px, 132x28 (1980x420 twips), picture boton-ingresar-default
// (clsGraphicalButton over/off states), NOT the 161x39 boton-conectar of the old main screen, which was clipped to the button box.
for (const [width, height] of [[1280, 800], [2560, 1400]] as const) {
  test(`login Conectar button is boton-ingresar at ${width}x${height}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chrome', 'pointer flow');
    await page.setViewportSize({ width, height });
    await page.route('**/ao-config.json', route => route.fulfill({ json: { mode: 'classic', serverProfile: 'classic', wsPath: '/bridge' } }));
    await page.goto('/');
    await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
    await expect(page.locator('#connect-stage')).toHaveAttribute('data-screen', 'login');
    const button = page.locator('#connect');
    const box = await button.evaluate(el => { const h = el as HTMLElement; const f = h.offsetParent as HTMLElement; return { left: h.offsetLeft, top: h.offsetTop, width: h.offsetWidth, height: h.offsetHeight, image: getComputedStyle(h).backgroundImage, parent: f.id }; });
    expect(box.parent).toBe('login');
    expect(Math.round(box.left)).toBe(183); expect(box.top).toBe(137); expect(box.width).toBe(132); expect(box.height).toBe(28);
    expect(box.image).toMatch(/boton-ingresar-default/);
    // The artwork is exactly the button's size: nothing is clipped.
    const natural = await page.evaluate(src => new Promise<[number, number]>(done => { const i = new Image(); i.onload = () => done([i.naturalWidth, i.naturalHeight]); i.src = src; }), box.image.replace(/^url\("|"\)$/g, ''));
    expect(natural).toEqual([132, 28]);
    await page.screenshot({ path: `artifacts/screenshots/conectar-button-after-${width}.png` });
    await page.locator('#email').fill('a@b.c'); await page.locator('#password').fill('secret12');
    await button.hover();
    await expect.poll(() => button.evaluate(el => getComputedStyle(el).backgroundImage)).toMatch(/boton-ingresar-over/);
  });
}
