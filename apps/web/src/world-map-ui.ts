/*
 * frmMapaGrande, the large world map, adapted from frmMapaGrande.frm and frmMain.MiniMap_MouseDown / Protocol.HandleShowFrmMapa:
 * a 771x719 form with the "ventanamapa" bitmap, the world picture (interface mapa<world>.bmp, 27 px per map cell, 19 x 22 cells) in a
 * 512x594 picture box, the player marker (Shape1), the selected-cell frame (lblAllies), the clan-call marker, the world / references checks,
 * the map search box and the map name and description labels. Left click selects a cell, right click sends `/TELEP YO <map> 50 50`
 * (the server refuses it for players). Positions are the .frm values / 15. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 *
 * The creature panel (ListView1, the four stat labels, listdrop with its icon and percentage, and the animated PlayerView preview) reads the
 * NPC section of the shown map's .csm and the NPC table (world-map-npcs.ts); QuestNPCsMapData.bin is the minimap's, not this form's.
 */
import { VbWindow, VbList } from './vb-window.js';
import { loadInterface } from './interface-assets.js';
import { BIG_TILE, bigMapCell, bigMapPlayer, clanCallMarker, findMap } from './world-map.js';
import type { World } from './world-map.js';
import type { Session } from './session.js';
import type { Animation, GraphicFrame } from './assets.js';
import { PREVIEW_INTERVAL_MS, previewStart, previewStep } from './world-map-npcs.js';
import type { NpcInfo, NpcRow, PreviewState } from './world-map-npcs.js';

/** JsonLanguage MENSAJE_573 (frmMapaGrande.Label1 for a map with no description). */
export const NO_MAP_INFO = 'Sin información relevante.';

export interface WorldMapDeps {
  worlds: () => readonly World[];
  /** MapDat.map_name of any map (CargarDatosMapa reads the map file); resolves to '' when unknown. */
  mapName: (map: number) => Promise<string>;
  /** NameMaps(map).desc ('' when none). */
  description: (map: number) => string;
  /** frmMapaGrande right click: `/TELEP YO <map> 50 50`. */
  teleport: (map: number) => void;
  /** AddtoRichTextBox frmMain.RecTxt: a line in the console. */
  say: (text: string) => void;
  /** The creature panel's data; without it the panel stays empty. */
  creatures?: CreatureData;
}

export interface CreatureData {
  /** CargarDatosMapa: the creatures of a map's file, one row per NpcIndex. */
  rows: (map: number) => Promise<NpcRow[]>;
  info: (npc: number) => NpcInfo | undefined;
  /** ObjData(n).Name and GrhIndex; undefined for an unknown object. */
  object: (index: number) => { name: string; grh: number } | undefined;
  preview: (body: number, head: number) => Promise<{ walk: (Animation | undefined)[]; head: (Animation | undefined)[]; headOffsetY: number }>;
  graphic: (grh: number) => Promise<GraphicFrame>;
}

const PREVIEW_W = 180, PREVIEW_H = 196;
const sheets = new Map<number, Promise<HTMLImageElement>>();
const sheet = (file: number) => {
  let pending = sheets.get(file);
  if (!pending) { const image = new Image(); image.src = `/ao-assets/Graficos/${file}.png`; pending = image.decode().then(() => image); sheets.set(file, pending); }
  return pending;
};
/** A frame as a canvas whose pure black is see-through (Grh_Render_To_Hdc skips black). */
const keyed = new Map<string, HTMLCanvasElement>();
async function frameCanvas(frame: GraphicFrame): Promise<HTMLCanvasElement> {
  const key = `${frame.file}/${frame.x}/${frame.y}/${frame.width}/${frame.height}`;
  let canvas = keyed.get(key);
  if (canvas) return canvas;
  const image = await sheet(frame.file);
  canvas = document.createElement('canvas'); canvas.width = frame.width; canvas.height = frame.height;
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  const pixels = ctx.getImageData(0, 0, frame.width, frame.height);
  for (let i = 0; i < pixels.data.length; i += 4) if (!pixels.data[i] && !pixels.data[i + 1] && !pixels.data[i + 2]) pixels.data[i + 3] = 0;
  ctx.putImageData(pixels, 0, 0); keyed.set(key, canvas);
  return canvas;
}

export class WorldMapUI {
  private window: VbWindow | undefined;
  private session: Session | undefined;
  private world = 1;
  private references = false;
  private picture!: HTMLElement; private player!: HTMLElement; private selected!: HTMLElement; private clanCell!: HTMLElement; private clanDot!: HTMLElement;
  private title!: HTMLElement; private info!: HTMLElement; private dungeonCheck!: HTMLElement; private referencesCheck!: HTMLElement; private search!: HTMLInputElement;
  private checkArt = ''; private token = 0;
  private creatures!: VbList; private stats!: { hp: HTMLElement; exp: HTMLElement; gold: HTMLElement; hit: HTMLElement };
  private drops!: VbList; private dropIcon!: HTMLCanvasElement; private dropPercent!: HTMLElement; private previewCanvas!: HTMLCanvasElement;
  private rows: NpcRow[] = []; private shownDrops: { name: string; grh: number; percent: number }[] = [];
  private pv: { body: number; head: number; walk: (Animation | undefined)[]; heads: (Animation | undefined)[]; offset: number; state: PreviewState; timer: number } | undefined;
  private creatureToken = 0;
  /** Test hook: the selected cell and what the form shows. */
  state = { cell: 0, map: 0, world: 1 };

  constructor(private readonly parent: HTMLElement, private readonly deps: WorldMapDeps) {}

  get isOpen() { return this.window?.isOpen === true; }
  close() { this.window?.close(); }

  /** HandleShowFrmMapa (an object of type map) and MiniMap_MouseDown: CalcularPosicionMAPA, then show. */
  open(session: Session) {
    this.session = session;
    if (this.isOpen) { this.calculate(true); return; }
    const win = new VbWindow(this.parent, { id: 'world-map-window', art: 'ventanamapa', size: [771, 719], title: 'Mapa del mundo', onClose: () => { this.stopPreview(); this.window = undefined; } });
    this.window = win;
    win.root.tabIndex = -1;
    this.picture = win.add(document.createElement('div'), [32, 94, 513, 594]); this.picture.className = 'wm-picture';
    Object.assign(this.picture.style, { backgroundRepeat: 'no-repeat', backgroundColor: '#000', overflow: 'hidden', cursor: 'default' });
    const marker = (cls: string, size: number, css: Record<string, string>) => {
      const el = document.createElement('div'); el.className = cls; Object.assign(el.style, { position: 'absolute', width: `${size}px`, height: `${size}px`, pointerEvents: 'none', display: 'none', boxSizing: 'border-box', ...css });
      this.picture.append(el); return el;
    };
    this.clanCell = marker('wm-clan-cell', BIG_TILE, { border: '1px solid #00ff00' });
    this.clanDot = marker('wm-clan-dot', 5, { background: '#00ff00', borderRadius: '50%' });
    this.selected = marker('wm-selected', BIG_TILE, { border: '2px solid #ffff00' });
    // Shape1: the player, a 75-twip (5 px) circle.
    this.player = marker('wm-player', 5, { background: '#ff0000', border: '1px solid #fff', borderRadius: '50%' });
    this.picture.addEventListener('pointerdown', event => this.pictureDown(event));
    this.picture.addEventListener('contextmenu', event => event.preventDefault());
    this.title = win.add(document.createElement('div'), [566, 88, 181, 37]); this.title.className = 'vb-label wm-title';
    Object.assign(this.title.style, { color: 'rgb(235,164,14)', font: 'bold 13px Tahoma, Arial, sans-serif', whiteSpace: 'normal', textAlign: 'center' });
    this.info = win.add(document.createElement('div'), [568, 120, 178, 40]); this.info.className = 'vb-label wm-info';
    Object.assign(this.info.style, { color: '#fff', font: '11px Arial, sans-serif', whiteSpace: 'normal', textAlign: 'center' });
    // Label6 / Label7 sit over the artwork's own "world" and "references" texts; Image2 / Image3 are the check marks.
    const labelBox = (box: readonly [number, number, number, number], label: string, onClick: () => void) => {
      const el = win.add(document.createElement('button'), box); el.type = 'button'; el.className = 'vb-hotspot'; el.setAttribute('aria-label', label); el.addEventListener('click', onClick);
      Object.assign(el.style, { background: 'transparent', border: '0', padding: '0' }); return el;
    };
    labelBox([600, 144, 65, 17], 'Referencias', () => this.toggleReferences());
    labelBox([584, 144, 65, 17], 'Mazmorras', () => this.toggleDungeon());
    this.dungeonCheck = labelBox([571, 159, 17, 17], 'Mapa de mazmorras', () => this.toggleDungeon());
    this.referencesCheck = labelBox([653, 159, 17, 17], 'Referencias del mapa', () => this.toggleReferences());
    void loadInterface('check-amarillo').then(url => { this.checkArt = url; this.paintChecks(); }).catch(() => undefined);
    this.search = win.input([622, 31, 41, 25], { maxLength: 4, light: true }) as HTMLInputElement;
    this.search.setAttribute('aria-label', 'Buscar mapa'); this.search.inputMode = 'numeric';
    // txtSearchMap_KeyPress: digits and backspace only.
    this.search.addEventListener('input', () => { this.search.value = this.search.value.replace(/\D/g, ''); });
    this.search.addEventListener('keydown', event => { if (event.key === 'Enter') this.runSearch(); });
    win.button('boton-buscar', [664, 30, 25, 25], 'Buscar', () => this.runSearch());
    win.closeButton([740, 0, 31, 28]);
    this.buildCreatures(win);
    win.root.focus();
    this.calculate(false);
  }

  private paintChecks() {
    const set = (el: HTMLElement, on: boolean) => { el.style.backgroundImage = on && this.checkArt ? `url("${this.checkArt}")` : ''; el.style.backgroundSize = '100% 100%'; el.dataset.checked = String(on); };
    set(this.dungeonCheck, this.world !== 1); set(this.referencesCheck, this.references);
  }
  /**
   * picMap.Picture = LoadInterface("mapa<world>[_referencias].bmp"); a missing file is Nothing (black). `plain` is cmdSearch's reload, which
   * loads "mapa<world>.bmp" even while Referencias is on. The pinned data has no mapa1_referencias.bmp, only mapa_referencias.bmp: that
   * one stands in for world 1 (the surface it draws); worlds 2 and 3 have no references picture, so they go black as in VB6.
   */
  private async setPicture(plain = false) {
    const token = ++this.token;
    const references = this.references && !plain;
    const stems = references ? [`mapa${this.world}_referencias`, ...(this.world === 1 ? ['mapa_referencias'] : [])] : [`mapa${this.world}`];
    for (const stem of stems) {
      try { const url = await loadInterface(stem); if (token === this.token && this.window) this.picture.style.backgroundImage = `url("${url}")`; return; } catch { /* next */ }
    }
    if (token === this.token && this.window) this.picture.style.backgroundImage = '';
  }

  /**
   * frmMapaGrande.CalcularPosicionMAPA, then Form_Activate. lblMapInfo names UserMap, Label1 is NameMaps(ResourceMap).desc. A map on a world
   * picks that world, its picture and the selection square (lblAllies); a map on none leaves world, picture and square alone while the form
   * was visible, else shows world 1. Form_Activate then clears Referencias and fills ListView1 for ResourceMap, showing its first creature.
   */
  private calculate(wasOpen: boolean) {
    const session = this.session; if (!session) return;
    const map = session.map ?? 0, resourceMap = session.resourceMap ?? map;
    const at = findMap(this.deps.worlds() as World[], map);
    if (at) this.world = at.world; else if (!wasOpen) this.world = 1;
    this.state.world = this.world; this.references = false;
    this.paintChecks();
    if (at || !wasOpen) void this.setPicture();
    this.showMap(map);
    this.info.textContent = this.deps.description(resourceMap) || NO_MAP_INFO;
    if (at) this.moveSelected(at.cell);
    this.update(session);
    void this.loadCreatures(resourceMap, true);
  }
  /** lblMapInfo(0) = MapDat.map_name & "(" & map & ")" (cmdSearch puts a space before the bracket). Label1 is not touched. */
  private showMap(map: number, spaced = false) {
    this.state.map = map;
    this.title.textContent = `(${map})`; this.title.dataset.map = String(map);
    void this.deps.mapName(map).then(name => { if (this.state.map === map && this.title) this.title.textContent = `${name}${spaced ? ' ' : ''}(${map})`; });
  }
  private moveSelected(cell: number) {
    this.state.cell = cell;
    if (!cell) { this.selected.style.display = 'none'; return; }
    const { left, top } = cellCorner(cell);
    this.selected.style.display = 'block'; this.selected.style.left = `${left}px`; this.selected.style.top = `${top}px`;
  }

  /** ActualizarPosicionMapa + ShowClanCall, every frame the window is open. */
  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; if (!session) { this.close(); return; } }
    if (!this.isOpen || !session) return;
    const at = findMap(this.deps.worlds() as World[], session.map ?? 0);
    // Shape1 is hidden when the player's map is not on the world shown (ActualizarPosicion only runs for the current world).
    if (at && at.world === this.world && session.position) {
      const { left, top } = bigMapPlayer(at.cell, session.position.x, session.position.y);
      this.player.style.display = 'block'; this.player.style.left = `${left}px`; this.player.style.top = `${top}px`;
    } else this.player.style.display = 'none';
    const call = session.guild.call;
    const callAt = call ? findMap(this.deps.worlds() as World[], call.map) : undefined;
    if (call && callAt && callAt.world === this.world) {
      const m = clanCallMarker(callAt.cell, call.x, call.y);
      this.clanDot.style.display = 'block'; this.clanDot.style.left = `${m.left}px`; this.clanDot.style.top = `${m.top}px`;
      this.clanCell.style.display = 'block'; this.clanCell.style.left = `${m.squareLeft}px`; this.clanCell.style.top = `${m.squareTop}px`;
    } else { this.clanDot.style.display = 'none'; this.clanCell.style.display = 'none'; }
  }

  /** picMap_MouseDown. */
  private pictureDown(event: PointerEvent) {
    const rect = this.picture.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (513 / rect.width), y = (event.clientY - rect.top) * (594 / rect.height);
    const session = this.session; if (!session) return;
    // A click on the clan-call marker reports where the ally is.
    const call = session.guild.call;
    if (call && this.clanDot.style.display !== 'none') {
      const left = parseFloat(this.clanDot.style.left), top = parseFloat(this.clanDot.style.top);
      if (x >= left && x <= left + 5 && y >= top && y <= top + 5) this.deps.say(`Ubicación del compañero (${call.map}-${call.x}-${call.y}).`);
    }
    const { cell } = bigMapCell(x, y);
    const world = this.deps.worlds()[this.world - 1];
    const map = world?.indice[cell - 1] ?? 0;
    if (!map || cell > (world?.indice.length ?? 0)) return; // Mundo(WorldActual).MapIndice(Mapa) = 0: nothing happens
    this.showMap(map);
    if (event.button === 2) this.deps.teleport(map);
    this.clearStats(); void this.loadCreatures(map, true);
    this.moveSelected(cell);
  }

  private runSearch() {
    const number = Number.parseInt(this.search.value, 10);
    if (!(number > 0)) { this.search.value = ''; return; }
    const at = findMap(this.deps.worlds() as World[], number);
    if (!at) return; // SearchMap False: nothing changes (the text stays)
    if (at.world !== this.world) this.toggleDungeon(); else void this.setPicture(true);
    this.showMap(number, true); this.moveSelected(at.cell);
    this.search.value = '';
    void this.loadCreatures(number, false).then(() => { if (this.state.map === number) this.clearPreview(); }); // PreviewNPC_Clear
  }
  /** ToggleDungeonView: worlds 1 and 2 swap (the code only knows those two). */
  toggleDungeon() {
    if (this.world === 1) this.world = 2; else if (this.world === 2) this.world = 1; else return;
    this.state.world = this.world; this.paintChecks(); void this.setPicture();
    if (this.session) this.update(this.session);
  }
  // ---- the creature panel: ListView1, Label2..5, listdrop, Picture1, PlayerView ----

  private buildCreatures(win: VbWindow) {
    // Controls (twips / 15): ListView1 8520,3900 2700x960; PlayerView 8520,5355 2700x2940; Label2/5 (hp, hit) 8550/9780,8355; Label3/4 (exp, gold) 8550/9780,8745,
    // 1500x255; listdrop 9360,9600 1800x780; Picture1 8685,9750 480x480; lblPercentageDrop 8730,9570.
    const dark = (el: HTMLElement) => Object.assign(el.style, { background: '#070707', font: '12px Arial, sans-serif', fontWeight: 'normal' });
    this.creatures = win.list([568, 260, 180, 64]); dark(this.creatures.el);
    this.creatures.el.setAttribute('aria-label', 'Criaturas del mapa');
    this.creatures.onSelect = index => { void this.showCreature(this.rows[index]); };
    this.previewCanvas = win.add(document.createElement('canvas'), [568, 357, PREVIEW_W, PREVIEW_H]);
    this.previewCanvas.width = PREVIEW_W; this.previewCanvas.height = PREVIEW_H; this.previewCanvas.setAttribute('aria-label', 'Vista de la criatura');
    const stat = (box: readonly [number, number, number, number]) => {
      const el = win.label('', box, 'vb-center'); Object.assign(el.style, { font: '12px Arial, sans-serif', color: '#fff' }); return el;
    };
    this.stats = { hp: stat([570, 557, 100, 17]), hit: stat([652, 557, 100, 17]), exp: stat([570, 583, 100, 17]), gold: stat([652, 583, 100, 17]) };
    this.drops = win.list([624, 640, 120, 52]); dark(this.drops.el); this.drops.el.setAttribute('aria-label', 'Objetos que suelta');
    this.drops.onSelect = index => this.showDrop(index);
    this.dropIcon = win.add(document.createElement('canvas'), [579, 650, 32, 33]);
    this.dropIcon.width = 32; this.dropIcon.height = 33; this.dropIcon.style.background = '#000'; this.dropIcon.setAttribute('aria-label', 'Imagen del objeto');
    this.dropPercent = win.label('', [582, 638, 28, 14], 'vb-center'); Object.assign(this.dropPercent.style, { font: '11px Arial, sans-serif', color: '#fff' });
  }

  /** CargarDatosMapa fills ListView1; with `first` the first creature is shown (ListView1_ItemClick). */
  private async loadCreatures(map: number, first: boolean) {
    const data = this.deps.creatures; if (!data || !this.isOpen) return;
    const token = ++this.creatureToken;
    const rows = await data.rows(map).catch(() => [] as NpcRow[]);
    if (token !== this.creatureToken || !this.isOpen) return;
    this.rows = rows;
    this.creatures.set(rows.map(row => row.name));
    // The count column is right-aligned, 30 px wide (50 when a scroll bar will show: more than four rows).
    [...this.creatures.el.children].forEach((child, i) => {
      const count = document.createElement('span'); count.textContent = String(rows[i]!.count);
      Object.assign(count.style, { float: 'right', width: '30px', textAlign: 'right' }); child.prepend(count); child.setAttribute('title', rows[i]!.name);
    });
    this.creatures.el.dataset.rows = String(rows.length);
    if (first && rows.length) this.creatures.select(0); else if (!rows.length) this.clearPreview();
  }

  /** ListView1_ItemClick: stats, drops and the animated preview of one creature. */
  private async showCreature(row: NpcRow | undefined) {
    const data = this.deps.creatures; const info = row ? data?.info(row.index) : undefined;
    this.creatureToken++; // a preview still loading for the previous row is dropped
    this.clearPreview();
    if (!data || !info) return;
    this.stats.hp.textContent = String(info.hp); this.stats.exp.textContent = String(info.exp); this.stats.gold.textContent = String(info.gold);
    this.stats.hit.textContent = `${info.minHit}/${info.maxHit}`;
    const shown = info.drops.flatMap(drop => { const object = data.object(drop.object); return object ? [{ name: object.name, grh: object.grh, percent: drop.percent }] : []; });
    this.shownDrops = shown; this.drops.set(shown.map(drop => drop.name));
    if (shown.length) this.drops.select(0);
    await this.startPreview(info);
  }
  /** listdrop_Click: the object's picture in Picture1 and its chance in lblPercentageDrop. */
  private showDrop(index: number) {
    const drop = this.shownDrops[index], data = this.deps.creatures;
    const ctx = this.dropIcon.getContext('2d')!; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 32, 33);
    if (!drop || !data) { this.dropPercent.textContent = ''; return; }
    this.dropPercent.textContent = `${drop.percent}%`;
    void data.graphic(drop.grh).then(frameCanvas).then(canvas => { if (this.shownDrops[index] === drop) ctx.drawImage(canvas, 0, 0); }).catch(() => undefined);
  }
  private clearStats() { for (const el of Object.values(this.stats)) el.textContent = ''; this.drops.set([]); this.shownDrops = []; this.dropPercent.textContent = ''; this.showDrop(-1); }
  /** PreviewNPC_Clear: stop the animation, empty the labels, the drop list and the picture boxes. */
  private clearPreview() { this.stopPreview(); this.clearStats(); const ctx = this.previewCanvas.getContext('2d')!; ctx.clearRect(0, 0, PREVIEW_W, PREVIEW_H); }
  private stopPreview() { if (this.pv) { window.clearInterval(this.pv.timer); this.pv = undefined; } }

  /** PreviewNPC_Setup_ByIndex + tmrPreview: south first, one frame every 120 ms, a quarter turn every 18 ticks. */
  private async startPreview(info: NpcInfo) {
    const data = this.deps.creatures; if (!data) return;
    const token = this.creatureToken;
    const art = await data.preview(info.body, info.head).catch(() => undefined);
    if (!art || token !== this.creatureToken || !this.isOpen) return;
    // Warm the sheets so the first frames do not skip.
    await Promise.all([...art.walk, ...art.head].flatMap(animation => animation ? animation.frames.map(frameCanvas) : [])).catch(() => undefined);
    if (token !== this.creatureToken || !this.isOpen) return;
    this.stopPreview();
    this.pv = { body: info.body, head: info.head, walk: art.walk, heads: art.head, offset: art.headOffsetY, state: previewStart(), timer: window.setInterval(() => this.tick(), PREVIEW_INTERVAL_MS) };
    this.drawPreview();
  }
  private tick() {
    const pv = this.pv; if (!pv) return;
    const h = pv.state.heading - 1;
    pv.state = previewStep(pv.state, pv.walk[h]?.frames.length ?? 1, pv.heads[h]?.frames.length ?? 1);
    this.drawPreview();
  }
  /** PreviewNPC_RenderFrame: the body centred, the head over it (DibujarNPC's rule), or the head alone for a body-less NPC. */
  private drawPreview() {
    const pv = this.pv; if (!pv) return;
    const h = pv.state.heading - 1, body = pv.walk[h], head = pv.heads[h];
    const bodyFrame = body?.frames[(pv.state.frame - 1) % Math.max(1, body.frames.length)], headFrame = head?.frames[(pv.state.frame - 1) % Math.max(1, head.frames.length)];
    const ctx = this.previewCanvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(30,30,30)'; ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const draw = (frame: GraphicFrame, x: number, y: number) => { const canvas = keyed.get(`${frame.file}/${frame.x}/${frame.y}/${frame.width}/${frame.height}`); if (canvas) ctx.drawImage(canvas, x, y); };
    if (bodyFrame) {
      const x = Math.floor((PREVIEW_W - bodyFrame.width) / 2), y = Math.floor((PREVIEW_H - bodyFrame.height) / 2);
      draw(bodyFrame, x, y);
      if (headFrame && pv.body) draw(headFrame, Math.floor((PREVIEW_W - headFrame.width) / 2) + 1, y + bodyFrame.height - headFrame.height + pv.offset);
    } else if (headFrame) draw(headFrame, Math.floor((PREVIEW_W - headFrame.width) / 2), Math.floor((PREVIEW_H - headFrame.height) / 2));
  }

  /** Image3_Click. Its `If Dungeon Then Exit Sub` never fires: ModUtils declares `Dungeon` and nothing in the client assigns it. */
  toggleReferences() {
    this.references = !this.references; this.paintChecks(); void this.setPicture();
  }
}

/** The picture-box corner of a grid cell. */
export function cellCorner(cell: number, columns = 19): { left: number; top: number } {
  return { left: ((cell - 1) % columns) * BIG_TILE, top: Math.floor((cell - 1) / columns) * BIG_TILE };
}
