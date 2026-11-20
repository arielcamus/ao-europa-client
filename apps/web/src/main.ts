import './style.css';
import { GameAssets } from './assets.js';
import { WorldRenderer } from './renderer.js';
import { GameClient } from './net.js';
import type { SessionState } from './net.js';
import { MovementInput } from './input.js';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing UI element ${id}`);
  return node as T;
}
const game = element('game'), overlay = element('login-overlay'), form = element<HTMLFormElement>('login');
const email = element<HTMLInputElement>('email'), password = element<HTMLInputElement>('password');
const address = element<HTMLInputElement>('bridge-url'), connect = element<HTMLButtonElement>('connect');
const message = element('message'), status = element('status'), position = element('position');
const leave = element<HTMLButtonElement>('disconnect'), controls = element('controls');
const sessionInfo = element('session-info'), steps = element('steps');
const zoomOut = element<HTMLButtonElement>('zoom-out'), zoomIn = element<HTMLButtonElement>('zoom-in');
const roofs = element<HTMLButtonElement>('roofs');
let renderer: WorldRenderer | undefined;
let rendererPromise: Promise<WorldRenderer> | undefined;
let epoch = 0, loadingKey = '', previousWalks = 0;
let currentMapName = '';
const client = new GameClient(onState);
const input = new MovementInput(game, element('dpad'), () => client.snapshot.status === 'ready', heading => { client.walk(heading); });
address.value = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/bridge`;
document.body.dataset.state = 'offline';

function onState(state: SessionState): void {
  const wasReady = document.body.dataset.state === 'ready';
  document.body.dataset.state = state.status;
  const ready = state.status === 'ready';
  if (ready && !wasReady) game.focus({ preventScroll: true });
  overlay.hidden = ready;
  controls.hidden = !ready;
  sessionInfo.hidden = !ready;
  leave.hidden = state.status === 'offline' || state.status === 'error';
  status.textContent = state.status === 'ready' ? 'Connected' : state.status === 'error' ? 'Disconnected' : state.status === 'offline' ? 'Offline' : 'Connecting';
  connect.disabled = !['offline', 'error'].includes(state.status);
  if (state.status !== 'offline') message.textContent = state.message;
  if (!ready) { input?.clear(); game.dataset.rendered = 'false'; }
  if (state.player) {
    position.textContent = `Map ${state.mapId} · ${state.player.x}, ${state.player.y}`;
    position.dataset.x = String(state.player.x); position.dataset.y = String(state.player.y);
    position.dataset.walks = String(state.walks); position.dataset.corrections = String(state.corrections);
    steps.textContent = `${state.walks} steps · ${state.corrections} corrections`;
    const key = `${epoch}/${state.resourceMap}/${state.player.body}/${state.player.head}`;
    if (state.resourceMap && key !== loadingKey && state.status !== 'error' && state.status !== 'offline') {
      loadingKey = key;
      game.dataset.rendered = 'false';
      void loadWorld(state, key);
    }
    renderer?.setPlayer(state.player, state.walks > previousWalks, client.stepInterval);
    previousWalks = state.walks;
  }
}
async function getRenderer(): Promise<WorldRenderer> {
  rendererPromise ??= (async () => {
    const assets = await GameAssets.load();
    const world = new WorldRenderer(game, assets, error => client.fail(error.message));
    try { await world.init(); } catch (error) { assets.destroy(); throw error; }
    renderer = world;
    return world;
  })().catch(error => { rendererPromise = undefined; throw error; });
  return rendererPromise;
}
async function loadWorld(state: SessionState, key: string): Promise<void> {
  try {
    const world = await getRenderer();
    const map = await world.assets.map(state.resourceMap);
    if (key !== loadingKey) return;
    await world.setMap(map, state.player!);
    if (key !== loadingKey) return;
    currentMapName = map.metadata.name;
    element('map-name').textContent = currentMapName;
    element('world-name').textContent = currentMapName.replace(/^Ciudad de /, '');
    game.dataset.map = String(state.resourceMap);
    client.setMapReady(state.resourceMap);
  } catch (error) { if (key === loadingKey) client.fail(error instanceof Error ? error.message : String(error)); }
}
form.addEventListener('submit', event => {
  event.preventDefault(); epoch++; loadingKey = ''; previousWalks = 0;
  try { client.connect(address.value, email.value, password.value); }
  catch (error) { client.fail(String(error)); }
});
leave.addEventListener('click', () => {
  epoch++; loadingKey = ''; input.clear(); client.disconnect();
  message.textContent = 'You left the world. Connect again when you’re ready.';
});
function setZoom(change: number): void {
  if (!renderer) return;
  renderer.setZoom(renderer.currentZoom + change);
  element('zoom-level').textContent = `${renderer.currentZoom}×`;
  zoomOut.disabled = renderer.currentZoom === 1;
  zoomIn.disabled = renderer.currentZoom === 3;
}
zoomOut.disabled = true;
zoomOut.addEventListener('click', () => setZoom(-1));
zoomIn.addEventListener('click', () => setZoom(1));
roofs.addEventListener('click', () => {
  const show = roofs.getAttribute('aria-pressed') !== 'true';
  roofs.setAttribute('aria-pressed', String(show));
  roofs.querySelector('span')!.textContent = show ? 'on' : 'off';
  renderer?.setRoofs(show);
});
let frame = 0;
function tick(now: number): void {
  input.tick();
  if (renderer && client.snapshot.status === 'ready') {
    try {
      renderer.draw(now);
      game.dataset.rendered = String(renderer.isSettled);
      game.dataset.sprites = String(renderer.spriteCount);
    } catch (error) { client.fail(error instanceof Error ? error.message : String(error)); }
  }
  frame = requestAnimationFrame(tick);
}
frame = requestAnimationFrame(tick);
window.addEventListener('pagehide', () => { input.clear(); client.disconnect(); });
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frame); input.destroy(); client.disconnect(); renderer?.destroy();
});
