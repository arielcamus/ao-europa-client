/*
 * frmMapaGrande, the large world map, adapted from frmMapaGrande.frm and frmMain.MiniMap_MouseDown / Protocol.HandleShowFrmMapa:
 * a 771x719 form with the "ventanamapa" bitmap, the world picture (interface mapa<world>.bmp, 27 px per map cell, 19 x 22 cells) in a
 * 512x594 picture box, the player marker (Shape1), the selected-cell frame (lblAllies), the clan-call marker, the world / references checks,
 * the map search box and the map name and description labels. Left click selects a cell, right click sends `/TELEP YO <map> 50 50`
 * (the server refuses it for players). Positions are the .frm values / 15. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 *
 * Not ported: the NPC list, the drop list and the animated NPC preview (ListView1, listdrop, PlayerView). They read ListNPCMapData
 * (QuestNPCsMapData.bin), which the local resource mount does not serve.
 */
import { VbWindow } from './vb-window.js';
import { loadInterface } from './interface-assets.js';
import { BIG_TILE, bigMapCell, bigMapPlayer, clanCallMarker, findMap } from './world-map.js';
import type { World } from './world-map.js';
import type { Session } from './session.js';

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
}

export class WorldMapUI {
  private window: VbWindow | undefined;
  private session: Session | undefined;
  private world = 1;
  private references = false;
  private picture!: HTMLElement; private player!: HTMLElement; private selected!: HTMLElement; private clanCell!: HTMLElement; private clanDot!: HTMLElement;
  private title!: HTMLElement; private info!: HTMLElement; private dungeonCheck!: HTMLElement; private referencesCheck!: HTMLElement; private search!: HTMLInputElement;
  private checkArt = ''; private token = 0;
  /** Test hook: the selected cell and what the form shows. */
  state = { cell: 0, map: 0, world: 1 };

  constructor(private readonly parent: HTMLElement, private readonly deps: WorldMapDeps) {}

  get isOpen() { return this.window?.isOpen === true; }
  close() { this.window?.close(); }

  /** HandleShowFrmMapa (an object of type map) and MiniMap_MouseDown: CalcularPosicionMAPA, then show. */
  open(session: Session) {
    this.session = session;
    if (this.isOpen) { this.calculate(); return; }
    const win = new VbWindow(this.parent, { id: 'world-map-window', art: 'ventanamapa', size: [771, 719], title: 'Mapa del mundo', onClose: () => { this.window = undefined; } });
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
    win.root.focus();
    this.calculate();
  }

  private paintChecks() {
    const set = (el: HTMLElement, on: boolean) => { el.style.backgroundImage = on && this.checkArt ? `url("${this.checkArt}")` : ''; el.style.backgroundSize = '100% 100%'; el.dataset.checked = String(on); };
    set(this.dungeonCheck, this.world !== 1); set(this.referencesCheck, this.references);
  }
  private async setPicture() {
    const token = ++this.token;
    const stems = this.references ? [`mapa${this.world}_referencias`, 'mapa_referencias'] : [`mapa${this.world}`];
    for (const stem of stems) {
      try { const url = await loadInterface(stem); if (token === this.token && this.window) this.picture.style.backgroundImage = `url("${url}")`; return; } catch { /* next */ }
    }
  }

  /** frmMapaGrande.CalcularPosicionMAPA: the world of the player's map, the marker, the selection on the player's cell. */
  private calculate() {
    const session = this.session; if (!session) return;
    const map = session.map ?? 0;
    const at = findMap(this.deps.worlds() as World[], map);
    if (at) { this.world = at.world; this.state.cell = at.cell; } else if (!this.isOpen) this.world = 1;
    this.state.world = this.world; this.references = false;
    this.paintChecks(); void this.setPicture();
    this.showMap(map);
    this.moveSelected(at?.cell ?? 0);
    this.update(session);
  }
  private showMap(map: number) {
    this.state.map = map;
    this.title.textContent = `(${map})`; this.title.dataset.map = String(map);
    const desc = this.deps.description(map);
    this.info.textContent = desc || NO_MAP_INFO;
    void this.deps.mapName(map).then(name => { if (this.state.map === map && this.title) this.title.textContent = `${name}(${map})`; });
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
    this.moveSelected(cell);
  }

  private runSearch() {
    const number = Number.parseInt(this.search.value, 10);
    if (!(number > 0)) { this.search.value = ''; return; }
    const at = findMap(this.deps.worlds() as World[], number);
    if (!at) return; // SearchMap False: nothing changes (the text stays)
    if (at.world !== this.world) this.toggleDungeon(); else void this.setPicture();
    this.showMap(number); this.moveSelected(at.cell);
    this.search.value = '';
  }
  /** ToggleDungeonView: worlds 1 and 2 swap (the code only knows those two). */
  toggleDungeon() {
    if (this.world === 1) this.world = 2; else if (this.world === 2) this.world = 1; else return;
    this.state.world = this.world; this.paintChecks(); void this.setPicture();
    if (this.session) this.update(this.session);
  }
  /** Image3_Click (not in the dungeon world). */
  toggleReferences() {
    if (this.world === 2) return; // `If Dungeon Then Exit Sub`
    this.references = !this.references; this.paintChecks(); void this.setPicture();
  }
}

/** The picture-box corner of a grid cell. */
export function cellCorner(cell: number, columns = 19): { left: number; top: number } {
  return { left: ((cell - 1) % columns) * BIG_TILE, top: Math.floor((cell - 1) / columns) * BIG_TILE };
}
