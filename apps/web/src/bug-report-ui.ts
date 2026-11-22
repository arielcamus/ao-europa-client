// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * "Reportar un bug": the in-game bug reporter window (docs/BUG-REPORTS.md). Opened by F8 (when the player has not bound F8 to an action)
 * or the frmMain "Bugs" button of the MENU tab. Drawn like the other in-game windows, on the configuration window's frame: what happened,
 * what was expected, whether to attach the screenshot,
 * Enviar / Cancelar, and "Escribir a un GM" for the classic FrmGmAyuda message. The context (character, client, logs) is collected
 * when Enviar is pressed; the screenshot when the window opens, so the window itself is never in the picture.
 */
import './bug-report.css';
import { VbWindow } from './vb-window.js';
import { loadInterface } from './interface-assets.js';
import { buildBugReport } from './bug-report-data.js';
import type { ReportInput, ScreenshotInfo } from './bug-report-data.js';
import type { Box } from './vb-window.js';

export type ReportContext = Omit<ReportInput, 'sessionId' | 'text' | 'expected' | 'screenshot'>;
export interface BugReportDeps {
  capture: () => ScreenshotInfo | undefined;
  context: () => ReportContext;
  /** The classic FrmGmAyuda (message to the GMs online); undefined while not in the world. */
  gmHelp: () => (() => void) | undefined;
  /** A line in the game console (or the login assistant). */
  say: (text: string) => void;
  post?: (body: string) => Promise<{ status: number; json: () => Promise<unknown> }>;
}

export const BUG_REPORT_URL = '/api/bug-report';

const newSessionId = () => {
  try { return crypto.randomUUID(); } catch { return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
};

export class BugReportUI {
  private win: VbWindow | undefined;
  /** One id per page load: the server's per-session rate limit and the triage grouping use it. */
  readonly sessionId = newSessionId();
  constructor(private readonly parent: HTMLElement, private readonly deps: BugReportDeps) {}
  get isOpen() { return this.win?.isOpen === true; }

  open() {
    if (this.win?.isOpen) { this.win.focus(); return; }
    const screenshot = this.deps.capture();
    // FrmGmAyuda's picture (es_ventanagm, 470x434: "MENSAJE AL STAFF", the LEE ATENTAMENTE banner, the black message box on the left, the
    // reason list on the right, CANCELAR / ENVIAR), its baked captions and reason circles painted out (reporterArt); our words drawn over it
    // in the game's fonts.
    const win = new VbWindow(this.parent, { id: 'bug-report-window', size: [ART_WIDTH, ART_HEIGHT], title: 'Reportar un bug', onClose: () => { if (this.win === win) this.win = undefined; art?.release(); } });
    this.win = win;
    let art: { release(): void } | undefined;
    win.root.classList.remove('vb-plain'); win.root.classList.add('bug-report-form');
    void reporterArt().then(result => {
      if (!win.isOpen) { result.release(); return; }
      art = result; win.root.style.backgroundImage = `url("${result.url}")`; win.root.classList.add('bug-report-art');
    }).catch(() => { win.root.classList.add('bug-report-bare'); });
    win.label('Reportar un bug', [157, 28, 260, 30], 'bug-report-title'); // after the message icon, in place of "MENSAJE AL STAFF"
    win.closeButton(t(6585, 0, 420, 420)).id = 'bug-report-close';
    win.label('¿Qué pasó?', [62, 80, 133, 20], 'bug-report-banner'); // the scroll banner (LEE ATENTAMENTE)
    // Left panel: the message, as large as the panel allows: its whole inner width (FrmGmAyuda's black box and a little more), from under the banner
    // to its bottom, over where the GM form has its intro.
    const text = win.input([38, 120, 182, 224], { multiline: true, maxLength: 4000 }) as HTMLTextAreaElement;
    text.id = 'bug-report-text'; text.placeholder = 'Contanos qué estabas haciendo y qué salió mal.'; text.classList.add('bug-report-field');
    // Right panel (the reason list's place, its circles covered): what is sent, the screenshot, what was expected.
    // The status replaces the intro while it has something to say (CSS: .bug-report-status:not(:empty) + .bug-report-intro).
    const status = win.label('', [252, 100, 178, 72], 'bug-report-status'); status.id = 'bug-report-status'; status.setAttribute('role', 'status');
    win.label('Se envían tu personaje y posición, una captura y los últimos mensajes de la consola. Nunca tu email ni tu contraseña.',
      [252, 100, 178, 72], 'bug-report-intro');
    // The game's check box (check-amarillo.bmp over a dark square), as in frmRetos: a button with role=checkbox.
    const box = document.createElement('button'); box.type = 'button'; box.id = 'bug-report-screenshot'; box.className = 'bug-report-checkbox';
    box.setAttribute('role', 'checkbox'); box.disabled = !screenshot;
    const caption = document.createElement('button'); caption.type = 'button'; caption.className = 'bug-report-check-label'; caption.disabled = !screenshot;
    caption.textContent = screenshot ? 'Incluir captura de pantalla' : 'Captura no disponible'; caption.tabIndex = -1;
    box.setAttribute('aria-label', screenshot ? 'Incluir captura de pantalla' : 'Captura no disponible');
    let attach = !!screenshot;
    const thumb = screenshot ? document.createElement('img') : undefined;
    const showCheck = () => {
      box.setAttribute('aria-checked', String(attach)); box.classList.toggle('checked', attach);
      if (thumb) thumb.style.opacity = attach ? '1' : '0.25';
    };
    const toggle = () => { if (!screenshot) return; attach = !attach; showCheck(); };
    box.addEventListener('click', toggle); caption.addEventListener('click', toggle);
    void loadInterface('check-amarillo').then(url => { box.style.setProperty('--check', `url("${url}")`); }).catch(() => undefined);
    win.add(box, [252, 182, 15, 15]); win.add(caption, [274, 181, 150, 17]);
    if (screenshot && thumb) {
      thumb.className = 'bug-report-thumb'; thumb.id = 'bug-report-thumb'; thumb.alt = 'Captura de pantalla';
      thumb.src = screenshot.dataUrl;
      win.add(thumb, [252, 202, 176, 70]);
    }
    showCheck();
    win.label('¿Qué esperabas? (opcional)', [252, 278, 178, 15], 'bug-report-small-label');
    const expected = win.input([252, 294, 176, 48], { multiline: true, maxLength: 2000 }) as HTMLTextAreaElement;
    expected.id = 'bug-report-expected'; expected.classList.add('bug-report-field');
    // The bottom bar: CANCELAR / ENVIAR are FrmGmAyuda's own pictures, moved right to make room for "Escribir a un GM" (reporterArt clears the bar).
    const gm = this.deps.gmHelp();
    if (gm) {
      const gmButton = win.add(document.createElement('button'), [36, 381, 128, 24]);
      gmButton.type = 'button'; gmButton.className = 'bug-report-text-button'; gmButton.id = 'bug-report-gm'; gmButton.textContent = 'Escribir a un GM';
      gmButton.addEventListener('click', () => { win.close(); gm(); });
    }
    const cancel = win.button('boton-cancelar', [171, 381, 128, 24], 'Cancelar', () => win.close()); cancel.id = 'bug-report-cancel';
    const send = win.button('boton-enviar', [306, 381, 128, 24], 'Enviar', () => { void submit(); }); send.id = 'bug-report-send';
    const submit = async () => {
      if (text.value.trim() === '') { status.textContent = 'Contanos qué pasó.'; text.focus(); return; }
      send.disabled = true; cancel.disabled = true; status.textContent = 'Enviando…';
      try {
        const payload = buildBugReport({ ...this.deps.context(), sessionId: this.sessionId, text: text.value, expected: expected.value, screenshot: attach ? screenshot : undefined });
        const response = await (this.deps.post ?? postJson)(JSON.stringify(payload));
        const body = await response.json().catch(() => ({})) as { id?: string; error?: string; retryAfterSeconds?: number };
        if (response.status === 201 && body.id) {
          status.textContent = `¡Gracias! Reporte ${body.id} enviado.`;
          this.deps.say(`Reporte de bug enviado (${body.id}). ¡Gracias!`);
          window.setTimeout(() => { if (this.win === win) win.close(); }, 2500);
          return;
        }
        status.textContent = response.status === 429
          ? `Enviaste muchos reportes seguidos. Probá de nuevo en ${Math.max(1, Math.ceil((body.retryAfterSeconds ?? 600) / 60))} min.`
          : `No se pudo enviar el reporte (${response.status}${body.error ? `: ${body.error}` : ''}).`;
      } catch (error) {
        status.textContent = 'No hay conexión con el servidor de reportes. Probá de nuevo.';
        console.warn(`[bug-report] ${error instanceof Error ? error.message : String(error)}`);
      }
      send.disabled = false; cancel.disabled = false;
    };
    text.addEventListener('input', () => { if (status.textContent === 'Contanos qué pasó.') status.textContent = ''; });
    text.focus();
  }
}

const ART_WIDTH = 470, ART_HEIGHT = 434;
/** FrmGmAyuda positions are twips; / 15 gives form pixels (gm-ui.ts). */
const t = (l: number, tp: number, w: number, h: number): Box => [Math.round(l / 15), Math.round(tp / 15), Math.round(w / 15), Math.round(h / 15)];
/** optConsult(i).Top in twips / 15, top to bottom: the seven reason circles of es_ventanagm (covered: the reporter has no reasons). */
const REASON_TOPS = [1590, 1950, 2310, 2670, 3045, 3405, 3765].map(top => Math.round(top / 15));
/**
 * The window's picture: es_ventanagm as loadInterface hands it out (every baked caption, title to ENVIAR, already painted out by
 * ui-captions.ts), drawn on a canvas, with what our window does not use covered by the plain texture beside it: the seven reason
 * circles (the right panel holds the screenshot and what was expected) and the CANCELAR / ENVIAR frames (our three buttons go where they fit). A copy of our own, so the
 * caption overlay never draws "MENSAJE AL STAFF" back over it.
 */
async function reporterArt(): Promise<{ url: string; release(): void }> {
  const source = await loadInterface('ventanagm');
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = ART_WIDTH; canvas.height = ART_HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(image, 0, 0, ART_WIDTH, ART_HEIGHT);
  for (const top of REASON_TOPS) ctx.drawImage(canvas, 380, top - 4, 26, 24, 255, top - 4, 26, 24);
  for (const [from, to, width] of COVERS) ctx.drawImage(canvas, from, BAR_TOP, width, BAR_HEIGHT, to, BAR_TOP, width, BAR_HEIGHT);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('no picture');
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}
const BAR_TOP = 376, BAR_HEIGHT = 34;
/** Plain strips of the bottom bar copied over the two baked button frames: [from x, to x, width]. */
const COVERS: readonly (readonly [number, number, number])[] = [[30, 80, 50], [30, 130, 50], [30, 180, 50], [30, 230, 50], [30, 280, 50], [30, 330, 50], [30, 380, 50]];

async function postJson(body: string) {
  const response = await fetch(BUG_REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { status: response.status, json: () => response.json() as Promise<unknown> };
}
