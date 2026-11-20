// AGPL-3.0-or-later. See ../../../LICENSE.
import './style.css';
import { Heading } from '@ao/protocol';
import { Session } from './session.js';
import { WorldRenderer } from './renderer.js';
import { applyClassicLayout } from './classic-layout.js';
import { ClassicUI, element } from './classic-ui.js';
import { doorClickTile } from './map-objects.js';
import { NpcDialog } from './npc-dialog.js';

applyClassicLayout();
const form = element<HTMLFormElement>('login'), account = element<HTMLInputElement>('email'), password = element<HTMLInputElement>('password');
const connect = element<HTMLButtonElement>('connect'), disconnect = element<HTMLButtonElement>('disconnect');
const errorBox = element('error'), viewport = element('viewport'), connection = element('connection');
const chatForm = element<HTMLFormElement>('chat-form'), chat = element<HTMLInputElement>('chat');
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
const clearInput = () => { keys.clear(); touchHeading = undefined; };
function walk(heading: Heading) {
  try { if (session && renderer.readyMap === session.resourceMap) session.walk(heading); }
  catch (error) { close(error instanceof Error ? error.message : String(error)); }
}
function close(message = 'Disconnected') {
  clearInput(); stoppedAt = performance.now(); chatForm.hidden = true; npcDialog.hide();
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
  await Promise.all([renderer.init(), ui.init()]);
  renderer.app.ticker.add(() => {
    const now = performance.now();
    try {
      if (session && session.phase !== 'closed') {
        session.tick();
        if (!session.tracker.locale && renderer.locale) session.tracker.locale = renderer.locale;
        const heading = touchHeading ?? [...keys.values()].at(-1);
        if (heading && renderer.readyMap === session.resourceMap) session.walk(heading);
        if (session.ready && session.resourceMap !== requestedMap) {
          requestedMap = session.resourceMap;
          const currentSession = session;
          connection.textContent = 'Loading map…';
          void renderer.loadMap(requestedMap!).catch(error => { if (session === currentSession && session.phase !== 'closed') close(String(error)); });
        }
      }
      renderer.render(session, now);
    } catch (error) { if (session?.phase !== 'closed') close(error instanceof Error ? error.message : String(error)); }
    if (now - lastUi > 100) { updateUi(now); lastUi = now; }
  });
}
function updateUi(now: number) {
  ui.update(session);
  if (!session) return;
  const playing = session.ready && renderer.readyMap === session.resourceMap;
  if (playing) {
    form.hidden = true; disconnect.hidden = false;
    element('map-name').textContent = renderer.mapName; element('map-name').title = renderer.mapName;
    element('character-name').textContent = session.self!.name;
    connection.textContent = 'Connected';
    element('map-number').textContent = String(session.map);
  } else if (session.phase !== 'closed') connection.textContent = session.ready ? 'Loading map…' : 'Connecting…';
  if (session.position) {
    element('position').textContent = `${session.position.x}, ${session.position.y}`;
    const dot = element('minimap-dot'); dot.hidden = !playing;
    dot.style.left = `${session.position.x - 2.5}px`; dot.style.top = `${session.position.y - 2.5}px`;
  }
  element('confirmed').textContent = String(session.confirmedWalks);
  element('corrected').textContent = String(session.correctedWalks);
  element('duration').textContent = `${Math.floor(((stoppedAt ?? now) - (session.loggedAt ?? session.connectedAt)) / 1000)} s`;
  viewport.dataset.rendered = String(playing && renderer.settled);
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
const openChat = () => {
  if (!session?.ready) return;
  if (!chatSupported) { session.ui.message('Este servidor aún no admite chat.'); return; }
  clearInput(); chatForm.hidden = false; chat.focus();
};
element('chat-open').onclick = openChat;
chatForm.addEventListener('submit', event => {
  event.preventDefault();
  try {
    if (!chat.value.trim() || session?.talk(chat.value)) {
      chat.value = ''; chatForm.hidden = true; renderer.app.canvas.focus();
    } else session?.ui.message('Espera un momento o acorta el mensaje (máximo 255 bytes).');
  } catch (error) { close(String(error)); }
});
const directions: Record<string, Heading> = { ArrowUp: Heading.North, KeyW: Heading.North, ArrowRight: Heading.East, KeyD: Heading.East, ArrowDown: Heading.South, KeyS: Heading.South, ArrowLeft: Heading.West, KeyA: Heading.West };
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') { npcDialog.hide(); chatForm.hidden = true; clearInput(); renderer.app.canvas.focus(); return; }
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, [role="listbox"], dialog')) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key === 'Enter') { event.preventDefault(); openChat(); return; }
  const heading = directions[event.code];
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
  // Servers without look-at support (community adapter) keep the old click-to-walk.
  if (chatSupported && event.pointerType === 'mouse' && event.button === 0 && session?.ready) {
    event.preventDefault(); renderer.app.canvas.focus();
    // One LeftClick per click (VB6 frmMain): on a door the tile follows the server's door rule, anywhere else it is the tile
    // itself. The counter is the session's shared one, so door, look-at, NPC and attack-target clicks never collide.
    const tile = doorAt(event) ?? tileAt(event);
    try { if (tile) session.leftClick(tile.x, tile.y); } catch (error) { close(String(error)); }
    return;
  }
  if (!event.isPrimary || !session?.ready) return;
  const door = doorAt(event);
  if (door) { event.preventDefault(); clearInput(); session.leftClick(door.x, door.y); renderer.app.canvas.focus(); return; }
  event.preventDefault(); clearInput(); aim(event); walk(touchHeading!);
  viewport.setPointerCapture(event.pointerId); renderer.app.canvas.focus();
});
viewport.addEventListener('pointermove', event => { if (viewport.hasPointerCapture(event.pointerId)) aim(event); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, clearInput);
window.addEventListener('pagehide', () => { close(); renderer.destroy(); });
void boot().then(() => { connect.disabled = false; }).catch(error => report(String(error)));
