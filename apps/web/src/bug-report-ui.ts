// AGPL-3.0-or-later. See ../../../LICENSE.
/*
 * "Reportar un bug": the in-game bug reporter window (docs/BUG-REPORTS.md). Opened by F8 (when the player has not bound F8 to an action)
 * or the frmMain "Bugs" button of the MENU tab. A plain VB form: what happened, what was expected, whether to attach the screenshot,
 * Enviar / Cancelar, and "Escribir a un GM" for the classic FrmGmAyuda message. The context (character, client, logs) is collected
 * when Enviar is pressed; the screenshot when the window opens, so the window itself is never in the picture.
 */
import './bug-report.css';
import { VbWindow } from './vb-window.js';
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
    const win = new VbWindow(this.parent, { id: 'bug-report-window', size: [440, 400], title: 'Reportar un bug', onClose: () => { if (this.win === win) this.win = undefined; } });
    this.win = win;
    win.root.classList.add('bug-report-form');
    win.label('Reportar un bug', [12, 10, 300, 16], 'vb-bold');
    win.label('¿Qué pasó?', [12, 34, 300, 14]);
    const text = win.input([12, 50, 416, 92], { multiline: true, light: true, maxLength: 4000 }) as HTMLTextAreaElement;
    text.id = 'bug-report-text'; text.placeholder = 'Contanos qué estabas haciendo y qué salió mal.';
    win.label('¿Qué esperabas que pasara? (opcional)', [12, 150, 300, 14]);
    const expected = win.input([12, 166, 416, 56], { multiline: true, light: true, maxLength: 2000 }) as HTMLTextAreaElement;
    expected.id = 'bug-report-expected';
    const check = document.createElement('label'); check.className = 'bug-report-check';
    const box = document.createElement('input'); box.type = 'checkbox'; box.id = 'bug-report-screenshot'; box.checked = !!screenshot; box.disabled = !screenshot;
    check.append(box, document.createTextNode(screenshot ? ' Incluir captura de pantalla' : ' Captura no disponible'));
    win.add(check, [12, 232, 270, 18]);
    if (screenshot) {
      const thumb = document.createElement('img'); thumb.className = 'bug-report-thumb'; thumb.id = 'bug-report-thumb'; thumb.alt = 'Captura de pantalla';
      thumb.src = screenshot.dataUrl;
      win.add(thumb, [296, 230, 132, 99]);
      box.addEventListener('change', () => { thumb.style.opacity = box.checked ? '1' : '0.25'; });
    }
    const note = win.label('También se envían tu personaje y posición, los últimos mensajes de la consola y datos técnicos del cliente. Nunca tu email ni tu contraseña.',
      [12, 256, 272, 70], 'vb-multi bug-report-note');
    note.style.whiteSpace = 'normal';
    const status = win.label('', [12, 334, 416, 14], 'bug-report-status'); status.id = 'bug-report-status'; status.setAttribute('role', 'status');
    const gm = this.deps.gmHelp();
    if (gm) win.command('Escribir a un GM', [12, 360, 120, 26], () => { win.close(); gm(); }).id = 'bug-report-gm';
    const cancel = win.command('Cancelar', [212, 360, 100, 26], () => win.close()); cancel.id = 'bug-report-cancel';
    const send = win.command('Enviar', [328, 360, 100, 26], () => { void submit(); }); send.id = 'bug-report-send';
    const submit = async () => {
      if (text.value.trim() === '') { status.textContent = 'Contanos qué pasó.'; text.focus(); return; }
      send.disabled = true; cancel.disabled = true; status.textContent = 'Enviando…';
      try {
        const payload = buildBugReport({ ...this.deps.context(), sessionId: this.sessionId, text: text.value, expected: expected.value, screenshot: box.checked ? screenshot : undefined });
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

async function postJson(body: string) {
  const response = await fetch(BUG_REPORT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { status: response.status, json: () => response.json() as Promise<unknown> };
}
