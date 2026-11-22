// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * "Reportar un bug": the in-game bug reporter window (docs/BUG-REPORTS.md). Opened by F8 (when the player has not bound F8 to an action)
 * or the frmMain "Bugs" button of the MENU tab. Drawn like the other in-game windows (reporterArt): one large box for what happened,
 * whether to attach the screenshot, Enviar / Cancelar, and "Escribir a un GM" for the classic FrmGmAyuda message. The context (character, client, logs) is collected
 * when Enviar is pressed; the screenshot when the window opens, so the window itself is never in the picture.
 */
import './bug-report.css';
import { VbWindow } from './vb-window.js';
import { loadInterface } from './interface-assets.js';
import { buildBugReport } from './bug-report-data.js';
import type { ReportInput, ScreenshotInfo } from './bug-report-data.js';

export type ReportContext = Omit<ReportInput, 'sessionId' | 'text' | 'screenshot'>;
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
    // One wide panel so the message box can span the window (Ariel, 22 Nov: one large box, the narrow GM columns were too cramped): the
    // frame of the configuration window (es_configuracion-vacio, 536x506) with FrmGmAyuda's message icon and scroll banner laid on it (reporterArt).
    const win = new VbWindow(this.parent, { id: 'bug-report-window', size: [ART_WIDTH, ART_HEIGHT], title: 'Reportar un bug', onClose: () => { if (this.win === win) this.win = undefined; art?.release(); } });
    this.win = win;
    let art: { release(): void } | undefined;
    win.root.classList.remove('vb-plain'); win.root.classList.add('bug-report-form');
    void reporterArt().then(result => {
      if (!win.isOpen) { result.release(); return; }
      art = result; win.root.style.backgroundImage = `url("${result.url}")`; win.root.classList.add('bug-report-art');
    }).catch(() => { win.root.classList.add('bug-report-bare'); });
    win.label('Reportar un bug', [TITLE_X, 24, 300, 30], 'bug-report-title'); // after the message icon, in place of "CONFIGURACIÓN"
    win.closeButton([505, 0, 29, 20]).id = 'bug-report-close';
    // The strip under the title: the screenshot toggle and thumbnail, then what is sent (a status or error replaces it while it has one;
    // CSS: .bug-report-status:not(:empty) + .bug-report-intro).
    const status = win.label('', [236, 76, 276, 30], 'bug-report-status'); status.id = 'bug-report-status'; status.setAttribute('role', 'status');
    win.label('Se envían tu personaje, una captura y los últimos mensajes de la consola. Nunca tu email ni tu contraseña.',
      [236, 76, 276, 30], 'bug-report-intro');
    // The panel: one large box across its whole width and height, "¿QUÉ PASÓ?" on the banner over it.
    win.label('¿Qué pasó?', [BANNER_TO[0] + 28, BANNER_TO[1] + 4, 133, 20], 'bug-report-banner'); // the scroll banner (LEE ATENTAMENTE)
    const text = win.input([26, 150, 484, 280], { multiline: true, maxLength: 4000 }) as HTMLTextAreaElement;
    text.id = 'bug-report-text'; text.placeholder = 'Contanos qué estabas haciendo y qué salió mal.'; text.classList.add('bug-report-field');
    // The game's check box (check-amarillo.bmp over a dark square), as in frmRetos: a button with role=checkbox.
    const box = document.createElement('button'); box.type = 'button'; box.id = 'bug-report-screenshot'; box.className = 'bug-report-checkbox';
    box.setAttribute('role', 'checkbox'); box.disabled = !screenshot;
    const caption = document.createElement('button'); caption.type = 'button'; caption.className = 'bug-report-check-label'; caption.disabled = !screenshot;
    caption.textContent = screenshot ? 'Incluir captura' : 'Sin captura'; caption.tabIndex = -1;
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
    win.add(box, [26, 83, 15, 15]); win.add(caption, [47, 82, 120, 17]);
    if (screenshot && thumb) {
      thumb.className = 'bug-report-thumb'; thumb.id = 'bug-report-thumb'; thumb.alt = 'Captura de pantalla';
      thumb.src = screenshot.dataUrl;
      win.add(thumb, [176, 77, 50, 29]);
    }
    showCheck();
    // The bottom bar (its key-binding button and icons covered): "Escribir a un GM", then the game's CANCELAR / ENVIAR pictures.
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
        const payload = buildBugReport({ ...this.deps.context(), sessionId: this.sessionId, text: text.value, screenshot: attach ? screenshot : undefined });
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
/** Where FrmGmAyuda's message icon and scroll banner come from (es_ventanagm px) and where they go on our frame. */
const ICON_FROM = [112, 24, 34, 34] as const, ICON_TO = [118, 22] as const;
const BANNER_FROM = [36, 77, 190, 42] as const, BANNER_TO = [34, 106] as const;
const TITLE_X = ICON_TO[0] + ICON_FROM[2] + 8;
/**
 * Copy a piece of `source` onto `ctx`, keeping only what stands out from the dark ground behind it: each pixel's opacity grows with its
 * brightness (fully clear at the ground's ~15, opaque from ~40), so the icon and the ribbon come over without the GM window's own panel
 * texture and frame lines around them.
 */
function lay(ctx: CanvasRenderingContext2D, source: HTMLImageElement, [x, y, w, h]: readonly number[], [toX, toY]: readonly number[]) {
  const piece = document.createElement('canvas'); piece.width = w!; piece.height = h!;
  const g = piece.getContext('2d', { willReadFrequently: true }); if (!g) return;
  g.drawImage(source, x!, y!, w!, h!, 0, 0, w!, h!);
  const data = g.getImageData(0, 0, w!, h!), px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    px[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (lum - 18) / 22)));
  }
  g.putImageData(data, 0, 0);
  ctx.drawImage(piece, toX!, toY!);
}
/**
 * The window's picture, composed on a canvas from two classic bitmaps as loadInterface hands them out (their baked captions painted out by
 * ui-captions.ts): es_configuracion-vacio for the frame (one wide panel under the title), with its bottom bar's "CONFIGURAR TECLAS" frame
 * and social icons covered by the plain bar beside them; and from es_ventanagm ("MENSAJE AL STAFF") the message icon before the title and
 * the scroll banner, laid with its back border on the panel's top border. A copy of our own, so the caption overlay draws nothing on it.
 */
async function reporterArt(): Promise<{ url: string; release(): void }> {
  const [frame, gm] = await Promise.all(['configuracion-vacio', 'ventanagm'].map(async name => {
    const image = new Image(); image.src = await loadInterface(name); await image.decode(); return image;
  }));
  const canvas = document.createElement('canvas'); canvas.width = ART_WIDTH; canvas.height = ART_HEIGHT;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(frame!, 0, 0, ART_WIDTH, ART_HEIGHT);
  // The bar between y 449 and 487 is plain from x 350 on: two copies of it over x 24..340 (the key-binding button and the icons).
  for (const x of [24, 182]) ctx.drawImage(canvas, 350, 449, 158, 38, x, 449, 158, 38);
  lay(ctx, gm!, ICON_FROM, ICON_TO);
  lay(ctx, gm!, BANNER_FROM, BANNER_TO);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('no picture');
  const url = URL.createObjectURL(blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}

async function postJson(body: string) {
  const response = await fetch(BUG_REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { status: response.status, json: () => response.json() as Promise<unknown> };
}
