// AGPL-3.0-or-later. See ../../../LICENSE.
import './style.css';
import { Heading } from '@ao/protocol';
import { Session } from './session.js';
import { WorldRenderer } from './renderer.js';
import { applyClassicLayout } from './classic-layout.js';
import { ClassicUI, element } from './classic-ui.js';
import { doorClickTile } from './map-objects.js';
import { NpcDialog } from './npc-dialog.js';
import { ChatBox } from './chat-box.js';
import { ChatBubbles } from './chat-bubbles.js';
import { sharedLocale } from './chat-locale.js';
import { CombatOverlay } from './combat-overlay.js';
import { fetchText } from './assets.js';
import { ItemsUI } from './items-ui.js';
import { KeyAction, keyAction } from './keymap.js';
import { KeysClientPacketId as K, WorkSkill } from '@ao/protocol';
import { Minimap } from './minimap.js';
import { AudioSystem } from './audio-system.js';
import './bank-trade.css';
import { BankUI } from './bank-ui.js';
import { TradeUI } from './trade-ui.js';

applyClassicLayout();
const form = element<HTMLFormElement>('login'), account = element<HTMLInputElement>('email'), password = element<HTMLInputElement>('password');
const connect = element<HTMLButtonElement>('connect'), disconnect = element<HTMLButtonElement>('disconnect');
const errorBox = element('error'), viewport = element('viewport'), connection = element('connection');
const chatForm = element<HTMLFormElement>('chat-form'), chat = element<HTMLInputElement>('chat');
const minimap = new Minimap(element('minimap'));
const keys = new Map<string, Heading>();
let touchHeading: Heading | undefined;
let session: Session | undefined;
let socket: WebSocket | undefined;
let requestedMap: number | undefined;
let wsPath = '/bridge';
let lastUi = 0;
let stoppedAt: number | undefined;
let chatSupported = true;
const report = (message: string) => {
  errorBox.textContent = message; errorBox.hidden = false;
  element('console').scrollTop = element('console').scrollHeight;
};
const renderer = new WorldRenderer(viewport, report);
const ui = new ClassicUI(renderer, report);
const npcDialog = new NpcDialog(element('classic'), renderer);
const bubbles = new ChatBubbles(element('chat-bubbles'));
const chatBox = new ChatBox(chatForm, chat, element('messages'), () => renderer.app.canvas.focus(), error => close(String(error)));
const combatOverlay = new CombatOverlay(viewport, renderer);
const itemsUi = new ItemsUI(ui, element('classic'), report);
ui.onActivate = slot => guard(() => session?.itemActions.activate(slot));
const audio = new AudioSystem(element('classic'), renderer, report);
const bankUi = new BankUI(element('classic'), ui, report);
const tradeUi = new TradeUI(element('classic'), viewport, ui, report);
/** IsDialogOpen: the bank, Goliath and trade windows pause walking. */
const transacting = () => bankUi.dialogOpen || tradeUi.dialogOpen;
const clearInput = () => { keys.clear(); touchHeading = undefined; };
function walk(heading: Heading) {
  try { if (session && !transacting() && renderer.readyMap === session.resourceMap) session.walk(heading); }
  catch (error) { close(error instanceof Error ? error.message : String(error)); }
}
function attack() {
  try { session?.attack(); } catch (error) { close(error instanceof Error ? error.message : String(error)); }
}
/** Run an item or key action; a write failure closes the session like every other send. */
function guard(action: () => unknown) {
  try { action(); } catch (error) { close(error instanceof Error ? error.message : String(error)); }
}
function close(message = 'Disconnected') {
  clearInput(); stoppedAt = performance.now(); chatBox.close(); npcDialog.hide(); audio.detach();
  if (session) {
    try { session.finish(message); } catch (error) { message = `${message}; ${String(error)}`; }
  }
  const old = socket; socket = undefined; old?.close();
  form.hidden = false; connect.disabled = false; disconnect.hidden = true;
  connection.textContent = message;
  if (message !== 'Disconnected') report(message);
}
async function boot() {
  const response = await fetch('/ao-config.json');
  if (!response.ok) throw new Error('Start this client with pnpm dev or pnpm dev:standin.');
  const config: { mode: string; serverProfile?: string; wsPath: string } = await response.json();
  if (!['standin', 'classic'].includes(config.mode) || config.wsPath !== '/bridge') throw new Error('Invalid local server configuration');
  if (config.serverProfile && !['classic', 'elixir-classic'].includes(config.serverProfile)) throw new Error('Invalid server profile');
  wsPath = config.wsPath;
  const community = config.mode === 'classic' && config.serverProfile === 'elixir-classic';
  chatSupported = !community; // The current opt-in community adapter only supports login/movement.
  element('mode').textContent = config.mode === 'standin' ? 'TEST STAND-IN' : community ? 'AO COMMUNITY SERVER' : 'CLASSIC · UNVERIFIED';
  element('mode-note').textContent = config.mode === 'standin' ? 'Prueba local · standin@local / testpass' : 'Conecta con tu cuenta. Se seleccionará el primer personaje.';
  element('scope-note').textContent = config.mode === 'standin'
    ? 'Mundo de prueba local. Objetos y estadísticas de muestra; sin combate ni persistencia.'
    : community ? 'Servidor comunitario · movimiento y persistencia. Chat aún no disponible.' : 'Cliente clásico · movimiento, inventario, hechizos y chat.';
  if (config.mode === 'standin') { account.value = 'standin@local'; password.value = 'testpass'; }
  await Promise.all([renderer.init(), ui.init(), bubbles.init(), audio.init()]);
  // Chat text that the server sends as locale ids; the console is redrawn once it arrives.
  void Promise.all([fetchText('init/sp_localindex.dat'), fetchText('init/SP_LocalMsg.dat')])
    .then(([index, messages]) => { sharedLocale.load(index, messages); if (session) session.ui.revision++; })
    .catch(error => report(String(error)));
  renderer.app.ticker.add(() => {
    const now = performance.now();
    try {
      if (session && session.phase !== 'closed') {
        session.tick();
        if (!session.tracker.locale && renderer.locale) session.tracker.locale = renderer.locale;
        const heading = touchHeading ?? [...keys.values()].at(-1);
        if (heading && !transacting() && renderer.readyMap === session.resourceMap) session.walk(heading);
        if (session.ready && session.resourceMap !== requestedMap) {
          requestedMap = session.resourceMap;
          const currentSession = session;
          connection.textContent = 'Loading map…';
          void renderer.loadMap(requestedMap!).catch(error => { if (session === currentSession && session.phase !== 'closed') close(String(error)); });
        }
      }
      renderer.render(session, now);
      bubbles.update(session, now);
      combatOverlay.update(session, now);
      audio.tick();
    } catch (error) { if (session?.phase !== 'closed') close(error instanceof Error ? error.message : String(error)); }
    if (now - lastUi > 100) { updateUi(now); lastUi = now; }
  });
}
function updateUi(now: number) {
  ui.update(session); bankUi.update(session); tradeUi.update(session);
  itemsUi.update(session);
  if (!session) return;
  const playing = session.ready && renderer.readyMap === session.resourceMap;
  minimap.update(session, playing);
  if (playing) {
    form.hidden = true; disconnect.hidden = false;
    element('map-name').textContent = renderer.mapName; element('map-name').title = renderer.mapName;
    element('character-name').textContent = session.self!.name;
    connection.textContent = 'Connected';
    element('map-number').textContent = String(session.map);
  } else if (session.phase !== 'closed') connection.textContent = session.ready ? 'Loading map…' : 'Connecting…';
  if (session.position) {
    element('position').textContent = `${session.position.x}, ${session.position.y}`;
  }
  element('confirmed').textContent = String(session.confirmedWalks);
  element('corrected').textContent = String(session.correctedWalks);
  element('duration').textContent = `${Math.floor(((stoppedAt ?? now) - (session.loggedAt ?? session.connectedAt)) / 1000)} s`;
  viewport.dataset.rendered = String(playing && renderer.settled);
  viewport.dataset.targeting = String(session.spells.targeting !== undefined);
  element('asset-note').hidden = renderer.clippedFrames === 0;
  element('asset-note').textContent = `El recurso local contiene ${renderer.clippedFrames} regiones fuera de su imagen. Los píxeles ausentes quedan transparentes.`;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (socket) return;
  clearInput(); errorBox.hidden = true; connect.disabled = true; stoppedAt = undefined; requestedMap = undefined;
  const url = new URL(wsPath, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url); socket = ws; ws.binaryType = 'arraybuffer';
  session = new Session({ email: account.value, password: password.value }, bytes => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024) throw new Error('Connection is not writable');
    ws.send(bytes.slice().buffer);
  });
  password.value = '';
  npcDialog.hide();
  const owner = session;
  session.tracker.onNpcDescription = ({ npcNumber }) => { if (session === owner) void npcDialog.show(npcNumber, renderer.locale); };
  chatBox.attach(session);
  audio.attach(session);
  ws.onmessage = event => {
    if (socket !== ws) return;
    try {
      if (!(event.data instanceof ArrayBuffer)) throw new Error('Expected binary WebSocket data');
      session!.receive(new Uint8Array(event.data));
    } catch (error) { close(error instanceof Error ? error.message : String(error)); }
  };
  ws.onerror = () => { if (socket === ws) close('Unable to connect to the local bridge'); };
  ws.onclose = () => { if (socket === ws) close('Server connection closed'); };
  renderer.app.canvas.focus();
});
disconnect.addEventListener('click', () => close());
// frmMain OpcionesBoton opens frmOpciones; here its sound part. The classic help lines stay on the same button.
element('settings').addEventListener('click', () => audio.options.toggle());
const openChat = (guild = false) => {
  if (!session?.ready) return;
  if (!chatSupported) { session.ui.message('Este servidor aún no admite chat.'); return; }
  clearInput(); chatBox.open(guild);
};
element('chat-open').onclick = () => openChat();
// Walking: bindings 14-17 of [DEFAULTSMODERN] (W S A D) plus the arrows (keymap.ts).
const WALK: Partial<Record<KeyAction, Heading>> = { [KeyAction.MoveUp]: Heading.North, [KeyAction.MoveDown]: Heading.South, [KeyAction.MoveLeft]: Heading.West, [KeyAction.MoveRight]: Heading.East };
const directions = { get: (code: string) => { const action = keyAction(code); return action === undefined ? undefined : WALK[action]; } };
const DEAD = '¡¡Estás muerto!!'; // MENSAJE_ESTAS_MUERTO
let lastClanCall = -Infinity;
/** modBindKeys.Accionar: what each [DEFAULTSMODERN] binding does. Bindings without a client feature yet say so in the console. */
function gameKey(action: KeyAction) {
  const s = session;
  if (!s?.ready) return;
  const dead = s.dead, slot = ui.selectedSlot;
  const unavailable = (what: string) => s.ui.message(`${what}: aún no disponible en este cliente.`);
  const ifAlive = (run: () => unknown) => { if (dead) s.ui.message(DEAD); else guard(run); };
  switch (action) {
    case KeyAction.Attack: attack(); return;
    case KeyAction.Loot: ifAlive(() => s.itemActions.pickUp()); return;
    case KeyAction.Drop: ifAlive(() => itemsUi.dropSelected()); return;
    case KeyAction.UseItem: guard(() => s.itemActions.useKey(slot)); return;
    case KeyAction.EquipItem: ifAlive(() => s.itemActions.equip(slot)); return;
    case KeyAction.ChangeSafe: // SeguroGame on: the key never turns it off (/SEG does)
      if (s.safeMode !== false) s.ui.message('Para desactivar el seguro escribe /SEG o usa el botón en la pestaña MENU en la esquina inferior derecha.');
      else guard(() => s.sendAction({ id: K.SafeToggle }));
      return;
    case KeyAction.HideNames: renderer.showNames = !renderer.showNames; return;
    case KeyAction.PartyToggle: guard(() => s.sendAction({ id: K.PartySafeToggle })); return;
    case KeyAction.Steal: ifAlive(() => s.sendAction({ id: K.Work, skill: WorkSkill.Steal, counter: 0 })); return;
    case KeyAction.RefreshPosition: guard(() => s.refreshPosition()); return;
    case KeyAction.Hide: ifAlive(() => s.sendAction({ id: K.Work, skill: WorkSkill.Hide, counter: 0 })); return;
    case KeyAction.ShowOnline: unavailable('Mostrar usuarios online'); return;
    case KeyAction.ScreenShot: unavailable('Captura de pantalla'); return;
    case KeyAction.ClanCall: case KeyAction.ClanMark: { // IntervaloPermiteLLamadaClan: 5 s between clan calls/marks
      const now = performance.now();
      if (now - lastClanCall < 5000) return;
      lastClanCall = now; guard(() => s.sendAction({ id: action === KeyAction.ClanCall ? K.ClanCall : K.ClanMark }));
      return;
    }
    case KeyAction.GameStats: unavailable('Estadísticas (FPS)'); return;
    case KeyAction.Meditate: // WriteMeditate: not with full mana, not dead, not while walking
      if (s.ui.stats.mana !== undefined && s.ui.stats.mana === s.ui.stats.maxMana) return;
      if (s.motion) return;
      ifAlive(() => s.sendAction({ id: K.Meditate }));
      return;
    case KeyAction.ExitGame: guard(() => s.sendAction({ id: K.Quit })); return;
    case KeyAction.Taming: ifAlive(() => s.sendAction({ id: K.Work, skill: WorkSkill.Tame, counter: 0 })); return;
    case KeyAction.SendText: openChat(); return;
    default:
      // Hotkeys 1-0 (WriteUseHKeySlot) only exist when the server enables them (FeatureToggles eEnableHotkeys), not decoded yet.
      if (action >= KeyAction.HotKey1 && action <= KeyAction.HotKey10) unavailable('Atajos 1-0');
  }
}
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { npcDialog.hide(); chatBox.close(); itemsUi.closeDialogs(); bankUi.closeDialogs(); tradeUi.closeDialogs(); clearInput(); session?.spells.cancel(); renderer.app.canvas.focus(); return; }
  // IsDialogOpen: while the vault, Goliath or a trade window is up the game keys (attack, use, drop...) do nothing.
  if (transacting()) return;
  // The inventory slot that was just clicked keeps focus; the game keys must still work from it.
  const inInventory = event.target instanceof HTMLElement && event.target.closest('#inventory') !== null;
  if (event.target instanceof HTMLElement && !inInventory && event.target.closest('input, textarea, select, button, [role="listbox"], dialog')) return;
  if (event.metaKey || event.altKey) return;
  const action = keyAction(event.code);
  // Control is itself a binding (attack); any other Control+key is the browser's.
  if (event.ctrlKey && action !== KeyAction.Attack) return;
  if (event.key === 'Delete') { event.preventDefault(); openChat(true); return; } // frmMain: Delete opens the guild chat box
  if (action !== undefined && action !== KeyAction.MoveUp && action !== KeyAction.MoveDown && action !== KeyAction.MoveLeft && action !== KeyAction.MoveRight) {
    event.preventDefault();
    // Attack repeats like the VB6 key (paced by Intervals.hit); every other action fires once per press.
    if (!event.repeat || action === KeyAction.Attack) gameKey(action);
    return;
  }
  const heading = directions.get(event.code);
  if (heading) { event.preventDefault(); keys.set(event.code, heading); walk(heading); }
});
window.addEventListener('keyup', event => { keys.delete(event.code); });
window.addEventListener('blur', clearInput);
window.addEventListener('resize', clearInput);
document.addEventListener('focusin', event => {
  if (event.target instanceof HTMLElement && event.target.closest('input, button, [role="listbox"]')) clearInput();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
// A phone keeps the exact classic layout. Touch the map in a direction from the
// character to walk; hit testing uses the scaled rectangle, not native pixels.
const aim = (event: PointerEvent) => {
  const rect = viewport.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
  touchHeading = Math.abs(x) > Math.abs(y) ? (x > 0 ? Heading.East : Heading.West) : (y > 0 ? Heading.South : Heading.North);
};
// Doors: the reference server opens/closes a door on LeftClick(x, y, counter) (HandleWorldAction); DoubleClick is ignored.
// A tap/click on a door sends LeftClick for the tapped tile (VB6 behaviour), shifted only when a character stands on it or below it.
function doorAt(event: PointerEvent | MouseEvent) {
  if (!session?.ready) return undefined;
  const tile = renderer.tileAt(session, event.clientX, event.clientY, performance.now());
  if (!tile) return undefined;
  const occupied = (x: number, y: number) => [...session!.characters.values()].some(c => c.x === x && c.y === y);
  return doorClickTile(session.mapObjects, objIndex => renderer.isDoor(objIndex), tile, occupied, (x, y) => renderer.fixedObjectAt(x, y));
}
// frmMain renderer MouseDown, left button: look at the tile (WriteLeftClick). The server answers
// with LocaleMsg (who/what you see) or an NPCDESC overhead; the mouse tile also reveals NPC names.
// One click-to-tile for doors, look-at and hover: the renderer's, which uses the camera of render().
const tileAt = (event: PointerEvent) => session ? renderer.tileAt(session, event.clientX, event.clientY, performance.now()) : undefined;
viewport.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') renderer.hoverTile = tileAt(event); });
viewport.addEventListener('pointerleave', () => { renderer.hoverTile = undefined; });
viewport.addEventListener('pointerdown', event => {
  bankUi.closeOnWorldClick(); // frmMain.renderer_MouseDown unloads frmBancoObj and frmGoliath
  if (!event.isPrimary || !session?.ready) return;
  // While the server asked for a target (UsingSkill <> 0) any click or tap is a WorkLeftClick (ModGameplayUI), never a LeftClick.
  if (session.spells.targeting) {
    event.preventDefault(); clearInput();
    const tile = tileAt(event);
    if (tile) try { session.spells.click(tile.x, tile.y); } catch (error) { close(String(error)); }
    renderer.app.canvas.focus(); return;
  }
  // Servers without look-at support (community adapter) keep the old click-to-walk.
  if (chatSupported && event.pointerType === 'mouse' && event.button === 0) {
    event.preventDefault(); renderer.app.canvas.focus();
    // One LeftClick per click (VB6 frmMain): on a door the tile follows the server's door rule, anywhere else it is the tile
    // itself. The counter is the session's shared one, so door, look-at, NPC and attack-target clicks never collide.
    const tile = doorAt(event) ?? tileAt(event);
    try { if (tile) session.leftClick(tile.x, tile.y); } catch (error) { close(String(error)); }
    return;
  }
  const door = doorAt(event);
  if (door) { event.preventDefault(); clearInput(); session.leftClick(door.x, door.y); renderer.app.canvas.focus(); return; }
  event.preventDefault(); clearInput(); aim(event); walk(touchHeading!);
  viewport.setPointerCapture(event.pointerId); renderer.app.canvas.focus();
});
viewport.addEventListener('pointermove', event => { if (viewport.hasPointerCapture(event.pointerId)) aim(event); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, clearInput);
window.addEventListener('pagehide', () => { close(); renderer.destroy(); });
void boot().then(() => { connect.disabled = false; }).catch(error => report(String(error)));
