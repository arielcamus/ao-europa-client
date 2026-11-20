// AGPL-3.0-or-later. See ../../../LICENSE.
import './style.css';
import { Heading } from '@ao/protocol';
import { Session } from './session.js';
import { WorldRenderer } from './renderer.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element ${id}`);
  return value as T;
}
const form = element<HTMLFormElement>('login'), account = element<HTMLInputElement>('email'), password = element<HTMLInputElement>('password');
const connect = element<HTMLButtonElement>('connect'), disconnect = element<HTMLButtonElement>('disconnect');
const errorBox = element('error'), viewport = element('viewport'), connection = element('connection');
const keys = new Map<string, Heading>();
let touchHeading: Heading | undefined;
let session: Session | undefined;
let socket: WebSocket | undefined;
let requestedMap: number | undefined;
let mode: 'standin' | 'classic';
let wsPath = '/bridge';
let lastUi = 0;
let stoppedAt: number | undefined;
const report = (message: string) => { errorBox.textContent = message; errorBox.hidden = false; };
const renderer = new WorldRenderer(viewport, report);
const clearInput = () => { keys.clear(); touchHeading = undefined; };
function walk(heading: Heading) {
  try { if (session && renderer.readyMap === session.resourceMap) session.walk(heading); }
  catch (error) { close(error instanceof Error ? error.message : String(error)); }
}
function close(message = 'Disconnected') {
  clearInput(); stoppedAt = performance.now();
  if (session) {
    try { session.finish(message); } catch (error) { message = `${message}; ${String(error)}`; }
  }
  const old = socket; socket = undefined; old?.close();
  form.hidden = false; connect.disabled = false; disconnect.hidden = true;
  element('dpad').hidden = true; connection.textContent = message;
  if (message !== 'Disconnected') report(message);
}
async function boot() {
  const response = await fetch('/ao-config.json');
  if (!response.ok) throw new Error('Start this client with pnpm dev or pnpm dev:standin.');
  const config: { mode: string; serverProfile?: string; wsPath: string } = await response.json();
  if (!['standin', 'classic'].includes(config.mode) || config.wsPath !== '/bridge') throw new Error('Invalid local server configuration');
  if (config.serverProfile && !['classic', 'elixir-classic'].includes(config.serverProfile)) throw new Error('Invalid server profile');
  mode = config.mode as typeof mode; wsPath = config.wsPath;
  const community = mode === 'classic' && config.serverProfile === 'elixir-classic';
  element('mode').textContent = mode === 'standin' ? 'TEST STAND-IN' : community ? 'AO COMMUNITY SERVER' : 'CLASSIC · UNVERIFIED';
  element('mode-note').textContent = mode === 'standin'
    ? 'A local test world with fixture accounts.'
    : community ? 'Community server with the classic protocol adapter. The first character is selected.'
    : 'Connect to your configured classic server with an existing account. The first character is selected.';
  element('scope-note').textContent = mode === 'standin'
    ? 'Protocol fixture only. No collision rules, NPCs, combat or persistence.'
    : community ? 'Real map collision and character persistence. This client preview supports login and movement.'
    : 'Map and character movement preview. Live compatibility is not yet verified.';
  if (mode === 'standin') { account.value = 'standin@local'; password.value = 'testpass'; }
  await renderer.init();
  renderer.app.ticker.add(() => {
    const now = performance.now();
    try {
      if (session && session.phase !== 'closed') {
        session.tick();
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
  if (!session) return;
  const playing = session.ready && renderer.readyMap === session.resourceMap;
  if (playing) {
    element('welcome').hidden = true; element('location').hidden = false; element('session-details').hidden = false;
    element('dpad').hidden = false; form.hidden = true; disconnect.hidden = false;
    element('map-name').textContent = renderer.mapName;
    element('character-name').textContent = session.self!.name;
    connection.textContent = 'Connected';
    element('map-number').textContent = String(session.map);
  } else if (session.phase !== 'closed') connection.textContent = session.ready ? 'Loading map…' : 'Connecting…';
  if (session.position) element('position').textContent = `${session.position.x}, ${session.position.y}`;
  element('confirmed').textContent = String(session.confirmedWalks);
  element('corrected').textContent = String(session.correctedWalks);
  element('duration').textContent = `${Math.floor(((stoppedAt ?? now) - (session.loggedAt ?? session.connectedAt)) / 1000)} s`;
  element('asset-note').hidden = renderer.clippedFrames === 0;
  element('asset-note').textContent = `Local artwork has ${renderer.clippedFrames} regions extending beyond their image. Missing pixels are left transparent.`;
}
form.addEventListener('submit', event => {
  event.preventDefault();
  if (socket) return;
  clearInput(); errorBox.hidden = true; connect.disabled = true; stoppedAt = undefined; requestedMap = undefined;
  element('welcome').hidden = false; element('welcome').querySelector('p')!.textContent = 'Connecting to your local world…';
  const url = new URL(wsPath, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url); socket = ws; ws.binaryType = 'arraybuffer';
  session = new Session({ email: account.value, password: password.value }, bytes => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024) throw new Error('Connection is not writable');
    ws.send(bytes.slice().buffer);
  });
  password.value = '';
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
const directions: Record<string, Heading> = { ArrowUp: Heading.North, KeyW: Heading.North, ArrowRight: Heading.East, KeyD: Heading.East, ArrowDown: Heading.South, KeyS: Heading.South, ArrowLeft: Heading.West, KeyA: Heading.West };
window.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.ctrlKey || event.metaKey || event.altKey) return;
  const heading = directions[event.code];
  if (heading) { event.preventDefault(); keys.set(event.code, heading); walk(heading); }
});
window.addEventListener('keyup', event => { keys.delete(event.code); });
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
document.querySelectorAll<HTMLButtonElement>('[data-heading]').forEach(button => {
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); clearInput(); touchHeading = Number(button.dataset.heading) as Heading;
    walk(touchHeading);
    button.setPointerCapture(event.pointerId);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, clearInput);
});
window.addEventListener('pagehide', () => { close(); renderer.destroy(); });
connect.disabled = true;
void boot().then(() => { connect.disabled = false; }).catch(error => report(String(error)));
