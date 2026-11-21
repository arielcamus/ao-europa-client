import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import {
  CraftingClientPacketId as CC, CraftingServerPacketId as CS, FrameDecoder, decodeClientPacket, encodeServerFrame,
} from '../../../packages/protocol/src/index.js';
import type { ServerPacket } from '../../../packages/protocol/src/index.js';
import { readForm } from './form-reference.js';
import type { Rect } from './form-reference.js';

// frmAlqui and FrmSastre (pinned client 619e69d) against the stand-in. The stand-in knows no crafting packets, so the page's WebSocket
// is intercepted: the forms are opened with the packets the VB6 server sent in tests/fixtures/vb6/crafting/alchemy-tailor-open.jsonl
// (AlquimistaObj [891], SastreObj [3578, 240, 3822]) and the build requests are captured here instead of reaching the stand-in.
// The geometry oracle is the original .frm read by form-reference.ts, never this client's layout constants.
const ALCHEMY_CONTROLS = ['lstArmas', 'List1', 'List2', 'picture1', 'cantidad', 'desc', 'cmdMasMenos-0', 'cmdMasMenos-1', 'Command3', 'Command4', 'salir'];
const TAILOR_CONTROLS = ['lstArmas', 'List1', 'List2', 'picture1', 'cantidad', 'desc', 'Image2', 'Image3', 'Command3', 'Command4', 'cmdCerrar', 'Command1', 'Command2'];
const ids: Record<string, string> = {
  lstArmas: 'objects', List1: 'materials', List2: 'amounts', picture1: 'picture', cantidad: 'quantity', desc: 'desc',
  'cmdMasMenos-0': 'minus', 'cmdMasMenos-1': 'plus', Image2: 'minus', Image3: 'plus', Command3: 'build', Command4: 'cancel', salir: 'close', cmdCerrar: 'close',
};

async function open(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  const sent: { id: number; object?: number }[] = [];
  let reply: (...packets: ServerPacket[]) => void = () => {};
  const mine = new Set<number>([CC.CraftAlquimista, CC.CraftSastre, CC.FlagTrabajar]);
  await page.routeWebSocket(/\/bridge/, ws => {
    const server = ws.connectToServer();
    const decoder = new FrameDecoder();
    reply = (...packets) => { for (const packet of packets) ws.send(Buffer.from(encodeServerFrame(packet))); };
    ws.onMessage(message => {
      const raw = typeof message === 'string' ? Buffer.from(message) : message;
      const packets = decoder.push(new Uint8Array(raw)).map(decodeClientPacket);
      if (packets.some(p => !('unknown' in p) && mine.has(p.id))) { for (const p of packets) if (!('unknown' in p)) sent.push(p as never); return; }
      server.send(raw);
    });
    ws.onClose(() => server.close());
    server.onMessage(message => ws.send(message));
  });
  await page.goto('/');
  await expect(page.locator('#classic')).toHaveAttribute('data-ui-ready', 'true');
  await page.locator('#connect').click();
  await expect(page.locator('#viewport')).toHaveAttribute('data-rendered', 'true');
  await mkdir('artifacts/screenshots', { recursive: true });
  return { failures, sent, reply: (...packets: ServerPacket[]) => reply(...packets) };
}

/** Control rectangles measured inside the form, in form pixels. */
async function measure(page: Page, id: string, controls: string[]) {
  return page.locator(`#${id}-window`).evaluate((root: HTMLElement, args) => {
    const frame = root.getBoundingClientRect(), scale = frame.width / root.offsetWidth;
    const out: Record<string, { x: number; y: number; width: number; height: number }> = {};
    for (const [control, suffix] of args.pairs) {
      const node = document.getElementById(`${args.id}-${suffix}`) ?? document.getElementById(`tailor-tab-${suffix}`);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      out[control] = { x: (r.x - frame.x) / scale, y: (r.y - frame.y) / scale, width: r.width / scale, height: r.height / scale };
    }
    return { out, size: { width: root.offsetWidth, height: root.offsetHeight } };
  }, { id, pairs: controls.map(control => [control, control === 'Command1' ? 'clothes' : control === 'Command2' ? 'hats' : ids[control]!] as const) });
}
function compare(expected: Record<string, Rect>, measured: Record<string, { x: number; y: number; width: number; height: number }>, controls: string[]) {
  for (const control of controls) {
    const source = expected[control], actual = measured[control];
    expect(source, `form has ${control}`).toBeDefined(); expect(actual, `window has ${control}`).toBeDefined();
    // Twips / 15 rounded to whole pixels: at most 0.67 px off.
    for (const field of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(actual![field] - source![field]), `${control}.${field}`).toBeLessThan(0.7);
  }
}
/** The VB6 form as the reference: its background bitmap from the local Recursos mount and every control's rectangle and name. */
async function reference(page: Page, form: string, art: string, size: [number, number], controls: string[], out: string) {
  const { rectangles } = await readForm(form);
  const boxes = controls.map(control => { const r = rectangles[control]!;
    return `<div style="position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;outline:1px solid #ff0;font:9px Tahoma;color:#ff0">${control}</div>`; }).join('');
  const html = `<body style="margin:0;background:#222"><div id="reference" style="position:relative;width:${size[0]}px;height:${size[1]}px;overflow:hidden">`
    + `<img src="/ao-assets/interface/es_${art}.bmp" style="position:absolute;left:0;top:0">${boxes}</div></body>`;
  const tab = await page.context().newPage();
  await tab.route('**/vb6-form-reference', route => route.fulfill({ contentType: 'text/html', body: '' }));
  await tab.goto('/vb6-form-reference');
  await tab.setContent(html);
  await tab.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
  await tab.locator('#reference').screenshot({ path: out });
  await tab.close();
}

test('frmAlqui: geometry, list, materials, +/- (Str, no floor), MsgBox with nothing selected, build closes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const { failures, sent, reply } = await open(page);
  reply({ id: CS.AlquimistaObj, objects: [891] }, { id: CS.ShowAlquimiaForm });
  const win = page.locator('#alchemy-window');
  await expect(win).toBeVisible();
  const { out, size } = await measure(page, 'alchemy', ALCHEMY_CONTROLS);
  expect(size).toEqual({ width: 432, height: 472 }); // ClientWidth 6480 x ClientHeight 7080 twips
  compare((await readForm('frmAlqui.frm')).rectangles, out, ALCHEMY_CONTROLS);
  await expect(page.locator('#alchemy-objects [role=option]')).toHaveCount(1);
  await expect(page.locator('#alchemy-quantity')).toHaveValue('1');

  // Command3 with nothing selected: MsgBox MENSAJE_SELECCIONAR_OBJETO, the form stays, nothing is sent.
  await page.locator('#alchemy-build').click();
  const box = page.locator('.craft-msgbox');
  await expect(box).toContainText('Debes seleccionar un objeto de la lista.');
  await page.screenshot({ path: 'artifacts/screenshots/crafting-35-alchemy-msgbox.png' });
  await box.getByRole('button', { name: 'Aceptar' }).click();
  await expect(box).toHaveCount(0); await expect(win).toBeVisible(); expect(sent).toEqual([]);

  // cmdMasMenos: Str(Val(cantidad) -/+ 1): a leading space for non-negative values, and it goes below zero.
  const minus = page.locator('#alchemy-minus'), plus = page.locator('#alchemy-plus'), quantity = page.locator('#alchemy-quantity');
  await minus.click(); await expect(quantity).toHaveValue(' 0');
  await minus.click(); await expect(quantity).toHaveValue('-1');
  await plus.click(); await plus.click(); await expect(quantity).toHaveValue(' 1');
  // The "off" bitmap stays after the press (there is no MouseUp handler).
  await expect(minus).toHaveCSS('background-image', /url/); await expect(plus).toHaveCSS('background-image', /url/);

  // Hover: Command3 shows its bitmap and clears Command4's; moving over the form clears both.
  await page.locator('#alchemy-build').hover(); await expect(page.locator('#alchemy-build')).toHaveAttribute('data-over', 'true');
  await page.locator('#alchemy-cancel').hover();
  await expect(page.locator('#alchemy-cancel')).toHaveAttribute('data-over', 'true'); await expect(page.locator('#alchemy-build')).toHaveAttribute('data-over', 'false');
  const frame = (await win.boundingBox())!;
  await page.mouse.move(frame.x + 20, frame.y + 60); await expect(page.locator('#alchemy-cancel')).toHaveAttribute('data-over', 'false');

  // lstArmas_Click: only the ingredients the object needs, List2 disabled (grey); List1_Click draws Grh 21926.
  await page.locator('#alchemy-objects [role=option]').first().click();
  await expect(page.locator('#alchemy-materials [role=option]').first()).toBeVisible();
  await expect(page.locator('#alchemy-amounts')).toHaveCSS('color', 'rgb(109, 109, 109)');
  await page.screenshot({ path: 'artifacts/screenshots/crafting-35-alchemy-page.png' });
  await win.screenshot({ path: 'artifacts/screenshots/crafting-35-alchemy-web.png' });
  await reference(page, 'frmAlqui.frm', 'ventanaalquimia', [432, 472], ALCHEMY_CONTROLS, 'artifacts/screenshots/crafting-35-alchemy-vb6-form.png');

  // One unit: a single CraftAlquimista, then Unload Me.
  await quantity.fill('1');
  await page.locator('#alchemy-build').click();
  await expect(win).toBeHidden();
  await expect.poll(() => sent).toEqual([{ id: CC.CraftAlquimista, object: 891 }]);
  expect(failures).toEqual([]);
});

test('FrmSastre: geometry, tabs, six skins, Image2 floor, build with nothing selected sends 0, cmdCerrar states', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chrome', 'desktop layout');
  const { failures, sent, reply } = await open(page);
  reply({ id: CS.SastreObj, objects: [3578, 240, 3822] }, { id: CS.ShowSastreForm });
  const win = page.locator('#tailor-window');
  await expect(win).toBeVisible();
  const { out, size } = await measure(page, 'tailor', TAILOR_CONTROLS);
  expect(size).toEqual({ width: 432, height: 475 });
  compare((await readForm('FrmSastre.frm')).rectangles, out, TAILOR_CONTROLS);
  // HandleShowSastreForm: the clothes list and Command1's highlight.
  await expect(page.locator('#tailor-tab-clothes')).toHaveCSS('background-image', /url/);
  await expect(page.locator('#tailor-tab-hats')).toHaveCSS('background-image', 'none');
  const rows = page.locator('#tailor-objects [role=option]');
  const clothes = await rows.count(); expect(clothes).toBeGreaterThan(0);

  // Image2 stops at 0, Image3 adds.
  const quantity = page.locator('#tailor-quantity');
  await page.locator('#tailor-minus').click(); await expect(quantity).toHaveValue('0');
  await page.locator('#tailor-minus').click(); await expect(quantity).toHaveValue('0');
  await page.locator('#tailor-plus').click(); await expect(quantity).toHaveValue('1');

  // lstArmas_Click: all six skins with their amounts, and the defence caption under List1.
  await rows.first().click();
  await expect(page.locator('#tailor-materials [role=option]')).toHaveCount(6);
  await expect(page.locator('#tailor-amounts [role=option]')).toHaveCount(6);
  await expect(page.locator('#tailor-desc')).toHaveText(/^Defensa: \d+\/\d+$/);
  // Command2_Click refills lstArmas only: the material lists stay.
  await page.locator('#tailor-tab-hats').click();
  await expect(page.locator('#tailor-tab-hats')).toHaveCSS('background-image', /url/);
  await expect(page.locator('#tailor-tab-clothes')).toHaveCSS('background-image', 'none');
  await expect(page.locator('#tailor-materials [role=option]')).toHaveCount(6);
  await page.locator('#tailor-tab-clothes').click();

  // cmdCerrar (clsGraphicalButton): default, over on move, off while pressed, default again from the form's MouseMove.
  const close = page.locator('#tailor-close');
  await expect(close).toHaveAttribute('data-state', 'default');
  await close.hover(); await expect(close).toHaveAttribute('data-state', 'over');
  await page.mouse.down(); await expect(close).toHaveAttribute('data-state', 'off');
  const frame = (await win.boundingBox())!;
  await page.mouse.move(frame.x + 20, frame.y + 60); await page.mouse.up();
  await expect(close).toHaveAttribute('data-state', 'default');
  await expect(win).toBeVisible();

  await rows.first().click();
  await page.screenshot({ path: 'artifacts/screenshots/crafting-35-tailor-page.png' });
  await win.screenshot({ path: 'artifacts/screenshots/crafting-35-tailor-web.png' });
  await reference(page, 'FrmSastre.frm', 'sastreria', [432, 475], TAILOR_CONTROLS, 'artifacts/screenshots/crafting-35-tailor-vb6-form.png');

  // Command3 after Command1_Click cleared the selection: SastreRopas(0).Index = 0 goes to the server, and the form unloads.
  await page.locator('#tailor-tab-clothes').click();
  await page.locator('#tailor-build').click();
  await expect(win).toBeHidden();
  await expect.poll(() => sent).toEqual([{ id: CC.CraftSastre, object: 0 }]);
  expect(failures).toEqual([]);
});
