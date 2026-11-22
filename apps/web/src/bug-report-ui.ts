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
    // The frame of the classic configuration window (frmOpciones' es_configuracion-vacio, 536x506), its captions painted out
    // (reporterArt), like every other in-game window: the title, labels and buttons are drawn over it in the game's fonts.
    const win = new VbWindow(this.parent, { id: 'bug-report-window', size: [ART_WIDTH, ART_HEIGHT], title: 'Reportar un bug', onClose: () => { if (this.win === win) this.win = undefined; art?.release(); } });
    this.win = win;
    let art: { release(): void } | undefined;
    win.root.classList.remove('vb-plain'); win.root.classList.add('bug-report-form');
    void reporterArt().then(result => {
      if (!win.isOpen) { result.release(); return; }
      art = result; win.root.style.backgroundImage = `url("${result.url}")`; win.root.classList.add('bug-report-art');
    }).catch(() => { win.root.classList.add('bug-report-bare'); });
    win.label('Reportar un bug', [0, 24, ART_WIDTH, 30], 'bug-report-title'); // in place of the baked "CONFIGURACIÓN"
    win.closeButton([505, 0, 29, 20]).id = 'bug-report-close';
    const note = win.label('También se envían tu personaje y posición, los últimos mensajes de la consola y datos técnicos del cliente. Nunca tu email ni tu contraseña.',
      [28, 74, 480, 34], 'bug-report-note');
    note.style.whiteSpace = 'normal';
    win.label('¿Qué pasó?', [28, 126, 300, 17], 'bug-report-label');
    const text = win.input([28, 145, 480, 100], { multiline: true, maxLength: 4000 }) as HTMLTextAreaElement;
    text.id = 'bug-report-text'; text.placeholder = 'Contanos qué estabas haciendo y qué salió mal.'; text.classList.add('bug-report-field');
    win.label('¿Qué esperabas que pasara? (opcional)', [28, 255, 330, 17], 'bug-report-label');
    const expected = win.input([28, 274, 480, 58], { multiline: true, maxLength: 2000 }) as HTMLTextAreaElement;
    expected.id = 'bug-report-expected'; expected.classList.add('bug-report-field');
    // The game's check box (check-amarillo.bmp over a dark square), as in frmRetos: a button with role=checkbox.
    const box = document.createElement('button'); box.type = 'button'; box.id = 'bug-report-screenshot'; box.className = 'bug-report-checkbox';
    box.setAttribute('role', 'checkbox'); box.disabled = !screenshot;
    const caption = document.createElement('button'); caption.type = 'button'; caption.className = 'bug-report-check-label'; caption.disabled = !screenshot;
    caption.textContent = screenshot ? 'Incluir captura de pantalla' : 'Captura no disponible'; caption.tabIndex = -1;
    box.setAttribute('aria-label', caption.textContent);
    let attach = !!screenshot;
    const thumb = screenshot ? document.createElement('img') : undefined;
    const showCheck = () => {
      box.setAttribute('aria-checked', String(attach)); box.classList.toggle('checked', attach);
      if (thumb) thumb.style.opacity = attach ? '1' : '0.25';
    };
    const toggle = () => { if (!screenshot) return; attach = !attach; showCheck(); };
    box.addEventListener('click', toggle); caption.addEventListener('click', toggle);
    void loadInterface('check-amarillo').then(url => { box.style.setProperty('--check', `url("${url}")`); }).catch(() => undefined);
    win.add(box, [28, 346, 17, 17]); win.add(caption, [50, 346, 260, 17]);
    if (screenshot && thumb) {
      thumb.className = 'bug-report-thumb'; thumb.id = 'bug-report-thumb'; thumb.alt = 'Captura de pantalla';
      thumb.src = screenshot.dataUrl;
      win.add(thumb, [388, 342, 120, 90]);
    }
    showCheck();
    const status = win.label('', [28, 374, 350, 56], 'bug-report-status'); status.id = 'bug-report-status'; status.setAttribute('role', 'status');
    const gm = this.deps.gmHelp();
    if (gm) {
      const gmButton = win.add(document.createElement('button'), [33, 453, 150, 27]);
      gmButton.type = 'button'; gmButton.className = 'bug-report-text-button'; gmButton.id = 'bug-report-gm'; gmButton.textContent = 'Escribir a un GM';
      gmButton.addEventListener('click', () => { win.close(); gm(); });
    }
    const cancel = win.button('boton-cancelar', [236, 453, 132, 28], 'Cancelar', () => win.close()); cancel.id = 'bug-report-cancel';
    const send = win.button('boton-enviar', [380, 453, 132, 28], 'Enviar', () => { void submit(); }); send.id = 'bug-report-send';
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

const ART_WIDTH = 536, ART_HEIGHT = 506;
/**
 * The window's picture: es_configuracion-vacio as loadInterface hands it out (its baked captions, "CONFIGURACIÓN" and "CONFIGURAR TECLAS",
 * already painted out by ui-captions.ts), drawn on a canvas, with the bottom bar's "CONFIGURAR TECLAS" frame and the five social icons covered
 * by the plain bar to their right. A copy of our own, so the caption overlay never draws "CONFIGURACIÓN" back over it.
 */
async function reporterArt(): Promise<{ url: string; release(): void }> {
  const source = await loadInterface('configuracion-vacio');
  const image = new Image(); image.src = source; await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = ART_WIDTH; canvas.height = ART_HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(image, 0, 0, ART_WIDTH, ART_HEIGHT);
  // The bar between y 449 and 487 is plain from x 350 on: two copies of it over x 24..340 (the key-binding button and the icons).
  for (const x of [24, 182]) ctx.drawImage(canvas, 350, 449, 158, 38, x, 449, 158, 38);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('no picture');
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}

async function postJson(body: string) {
  const response = await fetch(BUG_REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { status: response.status, json: () => response.json() as Promise<unknown> };
}
