// Independent test oracle: read the original VB6 forms, never production layout constants.
// No forms or licensed artwork are copied into this repository.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Control = { name: string; parent?: Control; fields: Record<string, string> };
export type Rect = { x: number; y: number; width: number; height: number };
const referenceRoot = process.env.AO_CLIENT_REFERENCE ?? join(homedir(), 'Projects/ao-reference/argentum-online-client-classic');
const resourceRoot = process.env.AO_ASSETS;
const number = (control: Control, name: string) => Number(control.fields[name]?.split("'")[0]?.trim() ?? 0);
export async function readForm(name = 'frmMain.frm') {
  const source = new TextDecoder('windows-1252').decode(await readFile(join(referenceRoot, 'CODIGO', name)));
  const stack: Control[] = [], controls = new Map<string, Control>();
  for (const line of source.split(/\r?\n/)) {
    const begin = /^\s*Begin (\S+) (\S+)/.exec(line);
    if (begin) {
      const control: Control = { name: begin[2]!, fields: {} };
      if (stack.length) control.parent = stack.at(-1)!;
      stack.push(control); continue;
    }
    const property = /^\s*(\w+)\s*=\s*(.+)/.exec(line);
    if (property && stack.length) stack.at(-1)!.fields[property[1]!] = property[2]!;
    if (line.trim() === 'End') {
      const control = stack.pop();
      if (control) controls.set(control.name + (control.fields.Index === undefined ? '' : `-${number(control, 'Index')}`), control);
    }
  }
  const rect = (control: Control): Rect => {
    const parent = control.parent?.parent ? rect(control.parent) : { x: 0, y: 0 };
    return { x: parent.x + number(control, 'Left') / 15, y: parent.y + number(control, 'Top') / 15,
      width: number(control, 'Width') / 15, height: number(control, 'Height') / 15 };
  };
  return { controls, rectangles: Object.fromEntries([...controls].map(([key, value]) => [key, rect(value)])) };
}
const style = (rect: Rect) => `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px`;
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

export async function referenceHTML(tab: 'inventory' | 'spells' = 'inventory') {
  if (!resourceRoot) throw new Error('AO_ASSETS is required to render the local VB6 reference.');
  const form = await readForm();
  const { rectangles: rects } = form;
  const art = (name: string, rect: Rect) => `<img alt="" src="/ao-assets/interface/es_${name}.bmp" style="${style(rect)}">`;
  const parts = [art('ventanaprincipal', { x: 0, y: 0, width: 1024, height: 768 }),
    art(tab === 'inventory' ? 'centroinventario' : 'centrohechizo', rects.panel!), art('ventanaprincipal_stats', rects.panelInf!)];
  parts.push(`<div style="${style(rects.renderer!)};background:#000"></div>`);
  if (tab === 'inventory') {
    const index = new TextDecoder('windows-1252').decode(await readFile(join(resourceRoot, 'init/graficos.ini')));
    const frame = (id: number) => {
      const match = new RegExp(`^Grh${id}=1-(\\d+)-(\\d+)-(\\d+)-(\\d+)-(\\d+)`, 'mi').exec(index);
      if (!match) throw new Error(`Missing reference slot graphic ${id}`);
      return match.slice(1).map(Number) as [number, number, number, number, number];
    };
    parts.push(`<div style="${style(rects.picInv!)};background:#000"></div>`);
    for (let slot = 0; slot < 42; slot++) {
      const [file, x, y, width, height] = frame(slot >= 24 ? 1122 : 47743);
      const pos = { x: rects.picInv!.x + slot % 6 * 35, y: rects.picInv!.y + Math.floor(slot / 6) * 35 + (slot >= 24 ? 9 : 0), width, height };
      parts.push(`<div style="${style(pos)};background-image:url('/ao-assets/Graficos/${file}.png');background-position:-${x}px -${y}px"></div>`);
    }
  } else {
    parts.push(`<div style="${style(rects.picHechiz!)};background:#000"></div>`);
    parts.push(art('boton-lanzar-default', rects.cmdlanzar!), art('boton-sm-flecha-arr-default', rects['cmdMoverHechi-1']!), art('boton-sm-flecha-aba-default', rects['cmdMoverHechi-0']!));
  }
  for (const [name, artwork, width, height] of [['Hpshp', 'barradevida', 216, 16], ['MANShp', 'barrademana', 216, 16], ['STAShp', 'barradeenergia', 89, 9], ['AGUAsp', 'barradesed', 32, 9], ['COMIDAsp', 'barradehambre', 32, 8], ['ExpBar', 'barraexperiencia', 235, 16]] as const) {
    parts.push(art(artwork, { ...rects[name]!, width, height }));
  }
  for (const name of ['NombrePJ', 'lblLvl', 'HpBar', 'manabar', 'stabar', 'AGUbar', 'hambar', 'GldLbl', 'exp', 'Coord', 'NameMapa']) {
    const caption = form.controls.get(name)?.fields.Caption?.replace(/^"|"$/g, '') ?? '';
    parts.push(`<span style="${style(rects[name]!)};font:bold ${name === 'NombrePJ' ? 16 : 11}px Tahoma,Arial;line-height:16px;text-align:center;color:#c8bebe;white-space:nowrap;overflow:hidden">${escape(caption)}</span>`);
  }
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>VB6 source-derived reference (not a running executable)</title><style>*{box-sizing:border-box}body{margin:0;background:#000;min-height:100svh;display:grid;place-items:center}#fit{position:relative}#reference{position:absolute;width:1024px;height:768px;transform-origin:top left;overflow:hidden}img{image-rendering:pixelated}</style></head><body><div id="fit"><div id="reference">${parts.join('')}</div></div><script>const resize=()=>{const s=Math.min(1,innerWidth/1024,innerHeight/768);document.getElementById('fit').style.cssText='width:'+1024*s+'px;height:'+768*s+'px';document.getElementById('reference').style.transform='scale('+s+')'};resize();addEventListener('resize',resize);</script></body></html>`;
}
