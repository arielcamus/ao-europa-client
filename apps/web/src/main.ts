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
import { SignOverlay } from './sign-ui.js';
import { sharedLocale } from './chat-locale.js';
import { CombatOverlay } from './combat-overlay.js';
import { characterTapTile } from './combat.js';
import { fetchText, parseIni, parseMap, fetchBytes } from './assets.js';
import type { Ini } from './assets.js';
import { loadObjectCatalog } from './object-catalog.js';
import type { ObjectCatalog } from './object-catalog.js';
import { npcInfo, npcRows, parseNpcSections } from './world-map-npcs.js';
import { WorldMapUI } from './world-map-ui.js';
import { parseWorlds } from './world-map.js';
import type { World } from './world-map.js';
import { ItemsUI } from './items-ui.js';
import { CraftingUI } from './crafting-ui.js';
import { CraftingExtraUI } from './crafting-extra-ui.js';
import { FishingUI } from './fishing-ui.js';
import { KeyAction, keyAction } from './keymap.js';
import { SkillsWindows } from './skills-window.js';
import { KeysClientPacketId as K, WorkSkill } from '@ao/protocol';
import { Minimap, parseQuestNpcDots } from './minimap.js';
import { AudioSystem } from './audio-system.js';
import './bank-trade.css';
import { BankUI } from './bank-ui.js';
import { TradeUI } from './trade-ui.js';
import { PartyUI } from './party-ui.js';
import { TravelUI } from './travel-ui.js';
import { ExtrasUI } from './extras-ui.js';
import { parseExtrasCommand } from './extras-commands.js';
import { GmUI } from './gm-ui.js';
import { GuildUI } from './guild-ui.js';
import { FrmMainButtons } from './frm-main-buttons.js';
import { QuestWindows } from './quest-window.js';
import { OptionsSettings } from './options-settings.js';
import { OptionsUI } from './options-ui.js';
import { KeyBindings } from './key-bindings.js';
import { KeysUI } from './keys-ui.js';
import { QuestVoice } from './quest-voice.js';
import { HotkeysUI, overHotkeyBar } from './hotkeys-ui.js';
import { windows } from './window-stack.js';
import { displayName } from './character-data.js';
import { KeyringUI } from './keyring-ui.js';
import { PapiroUI } from './papiro-ui.js';
import { InventoryExtras } from './inventory-extras.js';
import { ConnectUI } from './connect-ui.js';
import { LoadingCard, showConfirm, showConnecting, showExit, showMessage, showNewAccount } from './session-windows.js';
import { TEXT, silentLoginText } from './connect-text.js';
import { FloatingTexts } from './floating-text.js';
import type { SessionNotice } from './session.js';
import type { VbWindow } from './vb-window.js';

applyClassicLayout();
// Frmcarga is the first thing on screen: its art is requested before every other resource so it is not queued behind the atlases.
const loading = new LoadingCard(element('classic'));
loading.visible = true;
windows.install();
const form = element<HTMLFormElement>('login'), account = element<HTMLInputElement>('email'), password = element<HTMLInputElement>('password');
const connect = element<HTMLButtonElement>('connect'), disconnect = element<HTMLButtonElement>('disconnect');
const errorBox = element('error'), viewport = element('viewport'), connection = element('connection');
const chatForm = element<HTMLFormElement>('chat-form'), chat = element<HTMLInputElement>('chat');
const minimap = new Minimap(element('minimap'));
// Recursos.Cargarmapsworlddata and NameMaps (init/namemapa.dat): the world grid of the minimap and of frmMapaGrande. Both are optional data.
let worlds: World[] = [];
let mapNames = parseIni('');
void fetchText('init/mapsworlddata.dat').then(text => { worlds = parseWorlds(parseIni(text)); minimap.worlds = worlds; }).catch(error => report(`mapsworlddata.dat: ${String(error)}`));
// Recursos.CargarNPCsMapData: the quest NPC markers of the per-map minimap (OUTPUT/QuestNPCsMapData.bin).
void fetchBytes('OUTPUT/QuestNPCsMapData.bin').then(bytes => { minimap.questDots = parseQuestNpcDots(bytes); }).catch(() => undefined);
void fetchText('init/namemapa.dat').then(text => { mapNames = parseIni(text); }).catch(() => undefined);
const mapHeaderNames = new Map<number, Promise<string>>();
// NpcData / ObjData as frmMapaGrande reads them (Dat/npcs.dat, Dat/Obj.dat), loaded the first time the large map opens.
let npcTableCache: Ini | undefined, npcServerCache: Ini | undefined, catalogCache: ObjectCatalog | undefined;
const npcTable = async () => {
  if (!npcTableCache) {
    const [local, server, catalog] = await Promise.all([
      fetchText('init/sp_localindex.dat').then(parseNpcSections), fetchText('Dat/npcs.dat').then(parseNpcSections).catch(() => undefined), loadObjectCatalog().catch(() => undefined),
    ]);
    npcTableCache = local; npcServerCache = server; catalogCache = catalog;
  }
  return npcTableCache;
};
const keys = new Map<string, Heading>();
let touchHeading: Heading | undefined;
let session: Session | undefined;
let socket: WebSocket | undefined;
let requestedMap: number | undefined;
let wsPath = '/bridge';
let lastUi = 0;
let stoppedAt: number | undefined;
let chatSupported = true;
/** The account screen, character creation and message boxes belong to the classic server; the stand-in and the community adapter keep the one-click login. */
let interactiveFlow = true;
const report = (message: string) => {
  errorBox.textContent = message; errorBox.hidden = false;
  element('console').scrollTop = element('console').scrollHeight;
};
const renderer = new WorldRenderer(viewport, report);
const ui = new ClassicUI(renderer, report);
const npcDialog = new NpcDialog(element('classic'), renderer);
const skillsWindows = new SkillsWindows(element('classic'));
// frmMain: EstadisticasBoton (the skills arrow, 982,66 31x28) -> RequestSkills; ImgEstadisticas (Estadísticas in the info panel) -> RequestAtributes + RequestMiniStats.
const skillsButton = document.createElement('button');
skillsButton.type = 'button'; skillsButton.className = 'hotspot'; skillsButton.setAttribute('aria-label', 'Skills');
skillsButton.style.cssText = 'position:absolute;left:982px;top:66px;width:31px;height:28px;z-index:4';
element('classic').append(skillsButton);
skillsButton.onclick = () => { try { session?.requestSkills(); } catch (error) { close(String(error)); } };
ui.bindMenu('Estadísticas', () => { try { session?.requestStats(); } catch (error) { close(String(error)); } });
const bubbles = new ChatBubbles(element('chat-bubbles'));
const signOverlay = new SignOverlay(viewport, renderer);
const chatBox = new ChatBox(chatForm, chat, element('messages'), () => renderer.app.canvas.focus(), error => close(String(error)));
const combatOverlay = new CombatOverlay(viewport, renderer);
const runCommand = (line: string) => guard(() => chatBox.runLine(line));
const worldMapUi = new WorldMapUI(element('classic'), {
  worlds: () => worlds,
  // CargarDatosMapa reads the map file's own name (MapDat.map_name).
  mapName: map => {
    let name = mapHeaderNames.get(map);
    if (!name) { name = fetchBytes(`Mapas/mapa${map}.csm`).then(bytes => parseMap(bytes).name).catch(() => ''); mapHeaderNames.set(map, name); }
    return name;
  },
  description: map => mapNames.get('namemapa')?.get(`mapa${map}desc`) ?? '',
  teleport: map => runCommand(`/TELEP YO ${map} 50 50`),
  say: text => session?.ui.message(text),
  creatures: {
    // CargarDatosMapa: the NPC section of the map file; the stats come from the NPC table (world-map-npcs.ts).
    rows: async map => {
      const [bytes, table] = await Promise.all([fetchBytes(`Mapas/mapa${map}.csm`), npcTable()]);
      return npcRows(parseMap(bytes).npcs, table);
    },
    info: npc => npcTableCache ? npcInfo(npcTableCache, npcServerCache, npc) : undefined,
    object: index => { const o = catalogCache?.get(index); return o ? { name: o.name, grh: o.grh } : undefined; },
    preview: (body, head) => renderer.npcPreview(body, head),
    graphic: grh => renderer.graphic(grh),
  },
});
minimap.hooks = { openBigMap: () => { if (session) worldMapUi.open(session); }, teleport: (map, x, y) => runCommand(`/TELEP YO ${map} ${x} ${y}`) };
// frmMain.btnZoomIn / btnZoomOut: ApplyMinimapZoom -20 / +20, clamped to -50..50.
const zoomMinimap = (delta: number) => gameOptions.update({ centeredMinimapZoom: Math.max(-50, Math.min(50, gameOptions.value.centeredMinimapZoom + delta)) });
element('minimap-zoom-in').addEventListener('click', () => zoomMinimap(-20));
element('minimap-zoom-out').addEventListener('click', () => zoomMinimap(20));
const itemsUi = new ItemsUI(ui, element('classic'), report);
const craftingUi = new CraftingUI(ui, element('classic'), report);
const craftingExtraUi = new CraftingExtraUI(element('classic'), ui, renderer, report); // frmAlqui, FrmSastre, frmCrafteo
const fishingUi = new FishingUI(viewport, renderer); // the special-fish bar (RenderScreen)
ui.onActivate = slot => guard(() => session?.itemActions.activate(slot));
const audio = new AudioSystem(element('classic'), renderer, report);
const bankUi = new BankUI(element('classic'), ui, report);
const tradeUi = new TradeUI(element('classic'), viewport, ui, report);
// wp07: party frames / member window and the guild forms. Packets go through the session's one door (sendPacket).
const sendPackets = (...packets: (import('@ao/protocol').ClientPacket | undefined)[]) => {
  try { for (const packet of packets) if (packet) session?.sendPacket(packet); } catch (error) { close(error instanceof Error ? error.message : String(error)); }
};
const partyUi = new PartyUI(viewport, element('classic'), renderer, packet => sendPackets(packet));
// Group.HandleMouseInput: a group frame clicked while a spell is aimed casts it on that member (WriteActionOnGroupFrame).
partyUi.onFrameClick = groupId => { if (session?.spells.targeting?.skill === 1) { sendPackets(session.party.actOnFrame(groupId)); session.spells.cancel(); } };
const guildUi = new GuildUI(element('classic'), sendPackets);
const mainButtons = new FrmMainButtons({
  element, confirm: (text, yes) => { showConfirm(element('classic'), text, yes); }, send: packet => sendPackets(packet),
  openUrl: url => { window.open(url, '_blank', 'noopener,noreferrer'); }, openBugReport: () => gmUi.openHelp(),
});
mainButtons.init();
const gmUi = new GmUI(element('classic'), error => report(String(error))); // GM forms (wp12)
chatBox.onOpenWindow = window => (window === 'objects' ? gmUi.openObjects() : gmUi.openHelp());
const travelUi = new TravelUI(element('classic'), packet => sendPackets(packet)); // FrmViajes (wp05)
// Events, duels (frmRetos), the tournament organiser, battleground lobbies and the right-click menus (coverage-tail).
const extrasUi = new ExtrasUI(element('classic'), viewport, { send: packet => sendPackets(packet), runLine: line => chatBox.runLine(line), whisper: name => chatBox.whisperTo(name) });
gmUi.onTournament = () => extrasUi.openTournament();
chatBox.onCommand = line => {
  if (!session) return false;
  const cut = line.indexOf(' ');
  const outcome = parseExtrasCommand((cut < 0 ? line : line.slice(0, cut)).trim().toUpperCase(), cut < 0 ? '' : line.slice(cut + 1), { dead: session.dead, isGM: session.gm.isGM });
  if (!outcome) return false;
  for (const note of outcome.notes) session.ui.message(note.text, note.font);
  for (const packet of outcome.packets) session.sendChat(packet);
  if (outcome.open) extrasUi.openFor(outcome.open.window, outcome.open.names);
  return true;
};
ui.bindMenu('Grupo', () => sendPackets(session?.party.requestWindow()));
// ImgHogar_Click and Retar_Click: ParseUserCommand("/HOGAR") and ("/RETAR").
ui.bindMenu('Hogar', () => runCommand('/HOGAR'));
ui.bindMenu('Retos', () => runCommand('/RETAR'));
ui.bindMenu('Clanes', () => { if (session?.ready) sendPackets(session.guild.openGuildPanel()); });
// frmOpciones (graphics, gameplay and, through audio.options, sound), frmCustomKeys and the hotkey bar (feat/options-extras).
const gameOptions = new OptionsSettings();
const keyBindings = new KeyBindings();
const keysUi = new KeysUI(element('classic'), keyBindings, () => { /* the hotkey labels re-read the bindings on their next update */ });
const optionsUi = new OptionsUI(element('classic'), audio.options, gameOptions, keysUi, () => audio.director.click());
const hotkeysUi = new HotkeysUI(element('classic'), viewport, { itemArt: grh => ui.itemArt(grh), slotBackground: grh => ui.slotBackground(grh), graphic: grh => renderer.graphic(grh) });
// wp04: key ring (cmdLlavero), the papyrus form (ShowPapiro) and the inventory's item label, right-drag move and delete button.
const keyringUi = new KeyringUI(element('classic'), { itemArt: grh => ui.itemArt(grh), slotBackground: grh => ui.slotBackground(grh) },
  object => session?.catalog?.get(object)?.name ?? `Objeto ${object}`, object => session?.catalog?.get(object)?.grh ?? 0);
ui.bindMenu('Llavero', () => keyringUi.toggle());
const papiroUi = new PapiroUI(element('classic'));
// IsDialogOpen / IsDragDropBlockedByPanel: no drop onto the world while a shop, vault, trade, amount form or the key ring is up.
const inventoryExtras = new InventoryExtras(element('classic'), ui, {
  dropSelected: () => guard(() => itemsUi.dropSelected()),
  dropBlocked: () => transacting() || itemsUi.dialogOpen || keyringUi.isOpen || travelUi.isOpen || craftingUi.windowOpen || craftingExtraUi.windowOpen || (session?.items.shopOpen ?? false),
  overHotkeyBar: (x, y) => !!session?.options.hotkeysEnabled && !session.options.hideHotkeys && overHotkeyBar(viewport, element('classic'), x, y),
});
const fpsLabel = document.createElement('span'); fpsLabel.id = 'fps'; fpsLabel.hidden = true; element('classic').append(fpsLabel);
let lastFps = 0;
/** MostrarOnline: the VB6 key only flips this flag; the original client never draws anything from it. */
let showOnline = false;
const applyOptions = () => {
  fpsLabel.hidden = !gameOptions.value.showFps;
  if (session) session.ui.chat.copyToConsole = gameOptions.value.copyDialogToConsole;
};
gameOptions.subscribe(applyOptions);
applyOptions(); // the saved options (FPS label) apply from the first frame, not only after a change
const hotkeysLoaded = new WeakSet<Session>();
/** IsDialogOpen: the bank, Goliath and trade windows pause walking. */
const transacting = () => bankUi.dialogOpen || tradeUi.dialogOpen;
// frmConnect: the login, account and character-creation screens, and the small forms of the connect flow (frmMensaje, frmConnecting, Frmcarga).
/** False until the splash has done its job: the connect screen, the login box and the HUD stay hidden. */
let booted = false;
/** A picture whose download never completes must not hold the boot forever: after this long the screen shows anyway and the art paints when it lands. */
const STALL_MS = 12_000;
const stallGuard = (pending: Promise<unknown>) => Promise.race([pending, new Promise<void>(resolve => setTimeout(resolve, STALL_MS))]);
const floating = new FloatingTexts(element('chat-bubbles'));
let connectingWindow: VbWindow | undefined;
const connectUi = new ConnectUI(element('classic'), renderer, {
  enter: character => guard(() => session?.enterCharacter(character)),
  create: character => guard(() => session?.createCharacter(character)),
  logout: () => close('Disconnected', true),
  close: () => { close('Disconnected', true); try { window.close(); } catch { /* a tab the script did not open stays open */ } },
  message: text => { showMessage(element('classic'), text); },
  confirm: (text, yes) => { showConfirm(element('classic'), text, yes); },
  click: () => audio.director.click(),
});
const questWindows = new QuestWindows(element('classic'), renderer, undefined, report);
const questVoice = new QuestVoice(audio.engine, () => audio.director.language); questWindows.voice = questVoice;
// frmMain QuestBoton_MouseUp: WriteQuestListRequest; the server answers with the quest list.
ui.bindMenu('Quests', () => { try { session?.requestQuestList(); } catch (error) { close(String(error)); } });
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
/** `byPlayer`: the player (or a deliberate server Disconnect) ended it, so an unanswered character request is not explained. */
function close(message = 'Disconnected', byPlayer = false) {
  // A ShowMessageBox / ErrorMsg the server sent right before closing (refusal, then CloseSocket) still reaches the player; and a
  // character request that ends with no word from the server says so instead of dropping back to the login screen (char-create, 21 Nov).
  const live = session && session.phase !== 'closed' ? session : undefined;
  while (live?.notices.length) handleNotice(live.notices.shift()!);
  const silent = byPlayer ? undefined : live?.silentLoginFailure;
  connectingWindow?.close(); clearInput(); stoppedAt = performance.now(); chatBox.close(); npcDialog.hide(); audio.detach(); skillsWindows.closeAll(); questWindows.closeAll();
  if (session) {
    try { session.finish(message); } catch (error) { message = `${message}; ${String(error)}`; }
  }
  const old = socket; socket = undefined; old?.close();
  connect.disabled = false; disconnect.hidden = true;
  connection.textContent = message;
  if (message !== 'Disconnected') report(message);
  if (silent) { const text = silentLoginText(silent, message.startsWith('Timed out')); connectUi.say(text); showMessage(element('classic'), text); }
}
async function boot() {
  const response = await fetch('/ao-config.json');
  if (!response.ok) throw new Error('Start this client with pnpm dev or pnpm dev:standin.');
  const config: { mode: string; serverProfile?: string; wsPath: string } = await response.json();
  if (!['standin', 'classic'].includes(config.mode) || config.wsPath !== '/bridge') throw new Error('Invalid local server configuration');
  if (config.serverProfile && !['classic', 'elixir-classic'].includes(config.serverProfile)) throw new Error('Invalid server profile');
  wsPath = config.wsPath;
  const community = config.mode === 'classic' && config.serverProfile === 'elixir-classic';
  interactiveFlow = config.mode === 'classic' && !community;
  chatSupported = !community; // The current opt-in community adapter only supports login/movement.
  element('mode').textContent = config.mode === 'standin' ? 'TEST STAND-IN' : community ? 'AO COMMUNITY SERVER' : 'CLASSIC · UNVERIFIED';
  element('mode-note').textContent = config.mode === 'standin' ? 'Prueba local · standin@local / testpass' : 'Conecta con tu cuenta y elige tu personaje.';
  element('scope-note').textContent = config.mode === 'standin'
    ? 'Mundo de prueba local. Objetos y estadísticas de muestra; sin combate ni persistencia.'
    : community ? 'Servidor comunitario · movimiento y persistencia. Chat aún no disponible.' : 'Cliente clásico · movimiento, combate, objetos, hechizos, banco y chat.';
  if (config.mode === 'standin') { account.value = 'standin@local'; password.value = 'testpass'; }
  if (new URLSearchParams(location.search).has('debug')) element('classic').classList.add('debug');
  // Frmcarga over black while the resources load; the connect screen appears only once its art is complete.
  await Promise.all([renderer.init(), ui.init(), bubbles.init(), audio.init(), stallGuard(connectUi.ready), stallGuard(loading.ready), questWindows.init().catch(error => report(`Misiones no disponibles: ${String(error)}`))]);
  booted = true; element('classic').dataset.boot = 'ready'; performance.mark('ao-boot-ready');
  // Chat text that the server sends as locale ids; the console is redrawn once it arrives.
  void Promise.all([fetchText('init/sp_localindex.dat'), fetchText('init/SP_LocalMsg.dat')])
    .then(([index, messages]) => { sharedLocale.load(index, messages); if (session) { session.ui.chat.flushPending(); session.ui.revision++; } })
    .catch(error => report(String(error)));
  renderer.app.ticker.add(() => {
    const now = performance.now();
    try {
      if (session && session.phase !== 'closed') {
        session.tick();
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
      signOverlay.update(session);
      questWindows.update(session);
      combatOverlay.update(session, now);
      fishingUi.update(session, now);
      audio.tick();
      skillsWindows.update(session);
    } catch (error) { if (session?.phase !== 'closed') close(error instanceof Error ? error.message : String(error)); }
    if (now - lastUi > 100) { updateUi(now); lastUi = now; }
  });
}
function handleNotice(notice: SessionNotice) {
  if (notice.kind === 'error') { showMessage(element('classic'), notice.text); return; } // HandleErrorMessage: MsgBox
  const text = sharedLocale.message(notice.messageId, notice.extra) || `Mensaje ${notice.messageId}`;
  // HandleShowMessageBox: the login screen speaks through the assistant, every other screen opens frmMensaje.
  if (!session?.self && connectUi.current === 'login') connectUi.say(text); else showMessage(element('classic'), text);
  session?.backToAccount(); // a refused LoginNewChar / LoginExistingChar leaves the player on the account screen
}
let shownAccount = -1;
const shownMapForm = new WeakMap<object, number>();
/** The VB6 screen state machine: which connect screen, the connecting form and the loading card the session phase calls for. */
function syncConnect() {
  const s = session && session.phase !== 'closed' ? session : undefined;
  while (s?.notices.length) handleNotice(s.notices.shift()!);
  const playing = !!s && s.ready && renderer.readyMap === s.resourceMap;
  if (s?.phase === 'connecting') { if (!connectingWindow?.isOpen) connectingWindow = showConnecting(element('classic'), () => close('Disconnected', true)); } else connectingWindow?.close();
  element('classic').classList.toggle('in-world', playing); // frmMain exists only in the world
  if (!booted) { form.hidden = true; return; }
  if (playing) connectUi.setScreen('none');
  else if (s?.phase === 'account') {
    if (shownAccount !== s.accountRevision || connectUi.current === 'login' || connectUi.current === 'none') { shownAccount = s.accountRevision; connectUi.showAccount(s.accountCharacters); }
  } else if (!s) { shownAccount = -1; connectUi.setScreen('login'); }
  loading.visible = !booted || (!!s && (s.phase === 'login' || (s.phase === 'playing' && !playing)));
  form.hidden = !!s || connectUi.current !== 'login';
}
function updateUi(now: number) {
  syncConnect();
  if (session) floating.update(session, renderer, now);
  ui.update(session); bankUi.update(session); tradeUi.update(session); partyUi.update(session); guildUi.update(session); travelUi.update(session); gmUi.update(session); extrasUi.update(session); mainButtons.update(session);
  itemsUi.update(session); keyringUi.update(session); papiroUi.update(session); inventoryExtras.update(session);
  guard(() => craftingUi.update(session));
  guard(() => craftingExtraUi.update(session));
  if (!session) { hotkeysUi.update(undefined, false); return; }
  const playing = session.ready && renderer.readyMap === session.resourceMap;
  // ModSettings.LoadHotkeys: once per entry into the game, send the saved slots to the server.
  if (playing && session.self && !hotkeysLoaded.has(session)) { hotkeysLoaded.add(session); applyOptions(); session.optionsActions.loadHotkeys(session.self.name); }
  hotkeysUi.update(session, playing);
  if (gameOptions.value.showFps && now - lastFps > 500) { lastFps = now; fpsLabel.textContent = `FPS: ${Math.round(renderer.app.ticker.FPS)}`; }
  minimap.options = { centered: gameOptions.value.centeredMinimap, zoom: gameOptions.value.centeredMinimapZoom };
  minimap.update(session, playing, session.world.allies);
  if (session.world.mapForm.opened !== shownMapForm.get(session)) { shownMapForm.set(session, session.world.mapForm.opened); if (session.world.mapForm.opened > 0) worldMapUi.open(session); }
  worldMapUi.update(session);
  if (playing) {
    disconnect.hidden = false;
    element('map-name').textContent = renderer.mapName; element('map-name').title = renderer.mapName;
    element('character-name').textContent = displayName(session.self!.name);
    connection.textContent = 'Connected';
    element('map-number').textContent = String(session.map);
  } else if (session.phase !== 'closed') connection.textContent = session.ready ? 'Loading map…' : 'Connecting…';
  if (session.position) {
    element('position').textContent = `${session.position.x}, ${session.position.y}`;
  }
  // frmMain.lblhora: RevisarHoraMundo writes HH:MM of the in-game day; blank until the server has sent the time.
  element('clock').textContent = session.world.clock.inited ? session.world.clock.time(session.world.now()).label : '';
  element('confirmed').textContent = String(session.confirmedWalks);
  element('corrected').textContent = String(session.correctedWalks);
  element('duration').textContent = `${Math.floor(((stoppedAt ?? now) - (session.loggedAt ?? session.connectedAt)) / 1000)} s`;
  viewport.dataset.rendered = String(playing && renderer.settled);
  viewport.dataset.targeting = String(session.spells.targeting !== undefined);
  element('asset-note').hidden = renderer.clippedFrames === 0;
  element('asset-note').textContent = `El recurso local contiene ${renderer.clippedFrames} regiones fuera de su imagen. Los píxeles ausentes quedan transparentes.`;
}
/** DoLogin / CreateAccount: open the socket and start a session; the account screen takes over when the character list arrives. */
function connectSession(email: string, secret: string, create = false) {
  if (socket) return;
  clearInput(); errorBox.hidden = true; connect.disabled = true; stoppedAt = undefined; requestedMap = undefined;
  const url = new URL(wsPath, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url); socket = ws; ws.binaryType = 'arraybuffer';
  session = new Session({ email, password: secret, ...(create ? { create: true } : {}) }, bytes => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 64 * 1024) throw new Error('Connection is not writable');
    ws.send(bytes.slice().buffer);
  });
  session.interactive = interactiveFlow;
  { const mine = session; mine.terrain = (x, y) => renderer.readyMap === mine.resourceMap ? renderer.legalTileAt(x, y) : undefined; } // LegalPos reads MapData(x, y).Blocked / Trigger
  password.value = '';
  npcDialog.hide();
  const owner = session;
  // HandleDisconnect ends in General_Set_Connect (the login screen); HandleCerrarleCliente is CloseClient.
  session.onDisconnect = () => { if (session === owner) close('Disconnected', true); }; // a deliberate Disconnect (Quit), not a silent drop
  session.onCloseClient = () => { if (session === owner) { close('El servidor cerró el cliente.'); showMessage(element('classic'), 'El servidor cerró el cliente.'); } };
  session.tracker.onNpcDescription = ({ npcNumber }) => { if (session === owner) void npcDialog.showWhenReady(npcNumber, () => sharedLocale); };
  chatBox.attach(session);
  session.ui.chat.onQuestFinal = audioId => { if (session === owner) questVoice.play(audioId); };
  session.ui.chat.copyToConsole = gameOptions.value.copyDialogToConsole;
  audio.attach(session);
  ws.onmessage = event => {
    if (socket !== ws) return;
    try {
      if (!(event.data instanceof ArrayBuffer)) throw new Error('Expected binary WebSocket data');
      session!.receive(new Uint8Array(event.data));
    } catch (error) { close(error instanceof Error ? error.message : String(error)); }
  };
  ws.onerror = () => { if (socket === ws) { close('Disconnected'); connectUi.say(TEXT.connectionError); showMessage(element('classic'), TEXT.connectionError); } };
  ws.onclose = () => {
    if (socket !== ws) return;
    const wasPlaying = owner.phase === 'playing';
    // After a refusal (ErrorMsg) the server closes the socket: back to the login screen without a second complaint.
    close('Disconnected');
    if (wasPlaying) showMessage(element('classic'), TEXT.serverError);
  };
  renderer.app.canvas.focus();
}
const REMEMBER = 'ao.account';
const remembered = (() => { try { return localStorage.getItem(REMEMBER) ?? ''; } catch { return ''; } })();
form.addEventListener('submit', event => {
  event.preventDefault();
  try { if (remember.getAttribute('aria-checked') === 'true') localStorage.setItem(REMEMBER, account.value); else localStorage.removeItem(REMEMBER); } catch { /* storage may be blocked */ }
  connectSession(account.value, password.value);
});
// FrmLogear: chkRecordar (42.7,143), cmdCuenta (43,202) and cmdSalir (183,202). Only the e-mail is remembered, never the password.
const remember = document.createElement('button'); remember.type = 'button'; remember.className = 'cs-check'; remember.setAttribute('role', 'checkbox'); remember.setAttribute('aria-label', 'Recordarme');
remember.style.cssText = 'left:43px;top:143px'; remember.setAttribute('aria-checked', String(remembered !== ''));
void import('./interface-assets.js').then(({ loadInterface }) => loadInterface('check-amarillo').then(url => remember.style.setProperty('--check', `url("${url}")`)).catch(() => undefined));
remember.addEventListener('click', () => {
  const on = remember.getAttribute('aria-checked') !== 'true'; remember.setAttribute('aria-checked', String(on));
  connectUi.say(on ? TEXT.remember : TEXT.forget);
});
// FrmLogear.loadButtons: cmdIngresar uses boton-ingresar-default / -over / -off (clsGraphicalButton: over on hover, off while pressed), 132x28.
void import('./interface-assets.js').then(({ loadInterface }) => Promise.all(['over', 'off'].map(state => loadInterface(`boton-ingresar-${state}`).then(url => connect.style.setProperty(`--${state}`, `url("${url}")`)))).catch(() => undefined));
const accountButton = document.createElement('button'); accountButton.type = 'button'; accountButton.className = 'hotspot'; accountButton.setAttribute('aria-label', 'Crear cuenta'); accountButton.style.cssText = 'position:absolute;left:43px;top:202px;width:132px;height:28px';
accountButton.addEventListener('click', () => { if (!socket) showNewAccount(element('classic'), { create: (email, secret) => connectSession(email, secret, true), say: text => connectUi.say(text) }); });
const quitButton = document.createElement('button'); quitButton.type = 'button'; quitButton.className = 'hotspot'; quitButton.setAttribute('aria-label', 'Salir'); quitButton.style.cssText = 'position:absolute;left:183px;top:202px;width:132px;height:28px';
quitButton.addEventListener('click', () => { try { window.close(); } catch { /* ignored */ } connectUi.say('Podés cerrar esta pestaña cuando quieras.'); });
form.append(remember, accountButton, quitButton);
if (remembered) { account.value = remembered; connectUi.say(TEXT.welcomeBack); }
// frmMain Image4(1) opens frmCerrar: Menú principal = WriteQuit (the server counts down, then Disconnect), Salir = CloseClient.
disconnect.addEventListener('click', () => !interactiveFlow ? close('Disconnected', true) : showExit(element('classic'), {
  menu: () => guard(() => session?.sendAction({ id: K.Quit })),
  exit: () => { guard(() => session?.sendAction({ id: K.Quit })); window.setTimeout(() => { close('Disconnected', true); try { window.close(); } catch { /* ignored */ } }, 300); },
}));
// frmMain OpcionesBoton opens frmOpciones (gameplay, video, audio tabs, and the key editor).
element('settings').addEventListener('click', () => optionsUi.toggle());
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
/** modBindKeys.Accionar: what each [DEFAULTSMODERN] binding does. */
function gameKey(action: KeyAction) {
  const s = session;
  if (!s?.ready) return;
  const dead = s.dead, slot = ui.selectedSlot;
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
    // VB6 Accionar: eShowOnline flips MostrarOnline, which nothing reads; eScreenShoot (13) has no case at all. Both are faithful no-ops (issue #20 item 7).
    case KeyAction.ShowOnline: showOnline = !showOnline; return;
    case KeyAction.ScreenShot: return;
    case KeyAction.ClanCall: case KeyAction.ClanMark: { // IntervaloPermiteLLamadaClan: 5 s between clan calls/marks
      const now = performance.now();
      if (now - lastClanCall < 5000) return;
      lastClanCall = now; guard(() => s.sendAction({ id: action === KeyAction.ClanCall ? K.ClanCall : K.ClanMark }));
      return;
    }
    // VB6 eGameStats only runs SaveSetting("OPCIONES", "FPSFLAG", FPSFLAG): it persists the flag, the FPS checkbox of frmOpciones is what toggles it.
    case KeyAction.GameStats: gameOptions.update({ showFps: gameOptions.value.showFps }); return;
    case KeyAction.Meditate: // WriteMeditate: not with full mana, not dead, not while walking
      if (s.ui.stats.mana !== undefined && s.ui.stats.mana === s.ui.stats.maxMana) return;
      if (s.motion) return;
      ifAlive(() => s.sendAction({ id: K.Meditate }));
      return;
    case KeyAction.ExitGame: guard(() => s.sendAction({ id: K.Quit })); return;
    case KeyAction.Taming: ifAlive(() => s.sendAction({ id: K.Work, skill: WorkSkill.Tame, counter: 0 })); return;
    case KeyAction.SendText: openChat(); return;
    default:
      // Hotkeys 1-0: DoHotKey (needs the server's "hotokey-enabled" toggle, see options-state.ts).
      if (action >= KeyAction.HotKey1 && action <= KeyAction.HotKey10) guard(() => s.optionsActions.useHotkey(action - KeyAction.HotKey1));
  }
}
window.addEventListener('keydown', event => {
  // HandleKeyUp: Esc while UserSaliendo sends CancelarExit instead of HandleEsc (the windows keep their own Esc via the window stack).
  if (event.key === 'Escape' && session?.cancelExit()) return;
  if (event.key === 'Escape') { npcDialog.hide(); chatBox.close(); itemsUi.closeDialogs(); bankUi.closeDialogs(); tradeUi.closeDialogs(); craftingUi.closeAll(); craftingExtraUi.closeAll(); clearInput(); session?.spells.cancel(); renderer.app.canvas.focus(); return; }
  // IsDialogOpen: while the vault, Goliath or a trade window is up the game keys (attack, use, drop...) do nothing. The options and key windows are modal too.
  if (transacting() || optionsUi.visible) return;
  // PermitirMoverse ("Moverse al escribir"): the movement keys still walk while the chat box has focus.
  if (gameOptions.value.moveWhileTyping && event.target === chat && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const typingHeading = directions.get(event.code);
    if (typingHeading) { keys.set(event.code, typingHeading); walk(typingHeading); return; }
  }
  // The inventory slot that was just clicked keeps focus; the game keys must still work from it.
  const inInventory = event.target instanceof HTMLElement && event.target.closest('#inventory') !== null;
  if (event.target instanceof HTMLElement && !inInventory && event.target.closest('input, textarea, select, button, [role="listbox"], dialog')) return;
  if (event.metaKey || event.altKey) return;
  const action = keyAction(event.code);
  // Control is itself a binding (attack); any other Control+key is the browser's.
  if (event.ctrlKey && action !== KeyAction.Attack) return;
  // HandleKeyUp: Accionar (the bindings) runs first; only an unbound Delete opens the guild chat box.
  if (action === undefined && event.code === 'Delete') { event.preventDefault(); openChat(true); return; }
  if (action !== undefined && action !== KeyAction.MoveUp && action !== KeyAction.MoveDown && action !== KeyAction.MoveLeft && action !== KeyAction.MoveRight) {
    event.preventDefault();
    // Attack repeats like the VB6 key (paced by Intervals.hit); every other action fires once per press.
    if (!event.repeat || action === KeyAction.Attack) gameKey(action);
    return;
  }
  const heading = directions.get(event.code);
  if (heading) { event.preventDefault(); keys.set(event.code, heading); walk(heading); }
});
window.addEventListener('keyup', event => {
  keys.delete(event.code);
  // ModGameplayUI KeyUp: P (80) while PescandoEspecial is the try at the special fish (only when no text box has the focus).
  if (event.code === 'KeyP' && session?.craftingState.fishing.active && !transacting() && !(session.items.shopOpen) && !(event.target instanceof HTMLElement && event.target.closest('input, textarea'))) guard(() => session?.crafting.fishingKey());
});
window.addEventListener('blur', clearInput);
window.addEventListener('resize', clearInput);
// VB6: clicking a HUD button or tab never takes the keyboard from the game, so a held key keeps walking. A mouse press on a button/tab does not
// move the focus (the click still fires); keyboard focus on a button (Tab) is left alone. Only a text field taking focus stops the walk.
document.addEventListener('mousedown', event => {
  if (event.target instanceof HTMLElement && event.target.closest('button, [role="tab"]') && !event.target.closest('input, textarea, select, dialog, [role="dialog"], [role="alertdialog"]')) event.preventDefault();
});
document.addEventListener('focusin', event => {
  if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [role="listbox"]')) clearInput();
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
  const occupied = (x: number, y: number) => session!.tracker.at(x, y) !== undefined;
  return doorClickTile(session.mapObjects, objIndex => renderer.isDoor(objIndex), tile, occupied, (x, y) => renderer.fixedObjectAt(x, y));
}
// frmMain renderer MouseDown, left button: look at the tile (WriteLeftClick). The server answers
// with LocaleMsg (who/what you see) or an NPCDESC overhead; the mouse tile also reveals NPC names.
// One click-to-tile for doors, look-at and hover: the renderer's, which uses the camera of render().
const tileAt = (event: PointerEvent) => session ? renderer.tileAt(session, event.clientX, event.clientY, performance.now()) : undefined;
viewport.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') renderer.hoverTile = tileAt(event); });
viewport.addEventListener('pointerleave', () => { renderer.hoverTile = undefined; });
viewport.addEventListener('contextmenu', event => event.preventDefault());
viewport.addEventListener('pointerdown', event => {
  // frmMain.renderer_MouseDown, ACCION2 = INTERACT: the right button opens the player / pet / GM menu of the character under the mouse.
  if (event.pointerType === 'mouse' && event.button === 2 && session?.ready && chatSupported) {
    event.preventDefault(); extrasUi.closeMenu();
    const tile = tileAt(event), classic = element('classic').getBoundingClientRect();
    if (tile) extrasUi.interact(session, tile, { x: (event.clientX - classic.left) * 1024 / classic.width, y: (event.clientY - classic.top) * 768 / classic.height }, event.shiftKey);
    return;
  }
  bankUi.closeOnWorldClick(); // frmMain.renderer_MouseDown unloads frmBancoObj and frmGoliath
  partyUi.closeWindow(); guildUi.closeOnMapClick(); travelUi.closeOnWorldClick(); // ... and FrmGrupo and frmGuildList
  if (!event.isPrimary || !session?.ready) return;
  // frmMain MouseUp: clicX/clicY anchor the next sign; a world click removes the open one (ModGameplayUI: If cartel Then cartel = False).
  signOverlay.anchor(session, event.clientX, event.clientY, viewport.getBoundingClientRect()); session.sign = undefined;
  // While the server asked for a target (UsingSkill <> 0) any click or tap is a WorkLeftClick (ModGameplayUI), never a LeftClick.
  if (session.spells.targeting) {
    event.preventDefault(); clearInput();
    const tile = tileAt(event);
    if (tile) try { session.spells.click(tile.x, tile.y); } catch (error) { close(String(error)); }
    renderer.app.canvas.focus(); return;
  }
  // Servers without look-at support (community adapter) keep the old click-to-walk.
  if (chatSupported && event.pointerType === 'mouse' && event.button === 0) {
    event.preventDefault(); renderer.app.canvas.focus(); questWindows.closeOffers(); // frmMain.Form_MouseDown unloads FrmQuestInfo
    // One LeftClick per click (VB6 frmMain): on a door the tile follows the server's door rule, anywhere else it is the tile
    // itself. The counter is the session's shared one, so door, look-at, NPC and attack-target clicks never collide.
    const tile = doorAt(event) ?? tileAt(event);
    try { if (tile) session.leftClick(tile.x, tile.y); } catch (error) { close(String(error)); }
    return;
  }
  const door = doorAt(event);
  if (door) { event.preventDefault(); clearInput(); session.leftClick(door.x, door.y); renderer.app.canvas.focus(); return; }
  // Touch: a tap on another character selects it (LeftClick: NPC dialog, shop, attack target); anywhere else it walks.
  const tapped = tileAt(event), target = tapped && characterTapTile(session.tracker.chars.values(), session.charIndex, tapped);
  if (target) { event.preventDefault(); clearInput(); try { session.leftClick(target.x, target.y); } catch (error) { close(String(error)); } renderer.app.canvas.focus(); return; }
  event.preventDefault(); clearInput(); aim(event); walk(touchHeading!);
  viewport.setPointerCapture(event.pointerId); renderer.app.canvas.focus();
});
viewport.addEventListener('pointermove', event => { if (viewport.hasPointerCapture(event.pointerId)) aim(event); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(name, clearInput);
window.addEventListener('pagehide', () => { close('Disconnected', true); renderer.destroy(); });
void boot().then(() => { connect.disabled = false; }).catch(error => {
  // A failed boot (e.g. a missing sheet) still ends on the login screen with the error line, never on the empty HUD.
  booted = true; element('classic').dataset.boot = 'ready'; loading.visible = false;
  form.hidden = false; connectUi.setScreen('login'); report(String(error));
});
