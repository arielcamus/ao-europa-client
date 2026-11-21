/*
 * Small VB6 forms of the connect and logout flows, adapted 2026-11-21 from frmMensaje, frmNewAccount (frmCrearCuenta in PYMMO=0),
 * frmCerrar, frmConnecting and Frmcarga. Positions are the .frm values / 15. Copyright (C) 2022-2026 Noland Studios.
 * AGPL-3.0-or-later; see NOTICE. Artwork is read only from the local mount.
 */
import { VbWindow } from './vb-window.js';
import { loadInterface } from './interface-assets.js';
import { TEXT } from './connect-text.js';

type Box = readonly [number, number, number, number];
let counter = 0;
/** An art button whose bitmap may be missing from the local resources: a plain VB button stands in. */
function artButton(win: VbWindow, art: string, box: Box, label: string, run: () => void) {
  const b = win.button(art, box, label, run);
  void loadInterface(`${art}-default`).catch(() => { b.remove(); win.command(label, box, run); });
}

/** frmMensaje: 291x213, the message label at 40,80 (211x81), Aceptar at 80,168 and the X at 260,0. Enter or Escape closes it. */
export function showMessage(parent: HTMLElement, text: string, onClose?: () => void): VbWindow {
  const win = new VbWindow(parent, { id: `message-${++counter}`, art: 'mensaje', size: [291, 213], title: 'Mensaje', ...(onClose ? { onClose } : {}) });
  const label = win.label(text, [40, 80, 211, 81], 'vb-center vb-multi vb-bold');
  label.style.fontSize = '12px'; label.style.whiteSpace = 'normal'; label.style.lineHeight = '14px';
  artButton(win, 'boton-aceptar', [80, 168, 132, 28], 'Aceptar', () => win.close());
  win.closeButton([260, 0, 31, 28]);
  win.root.addEventListener('keydown', e => { if (e.key === 'Enter') win.close(); });
  win.root.tabIndex = 0; win.root.focus();
  return win;
}

/** MsgBox(vbYesNo): a plain VB form. */
export function showConfirm(parent: HTMLElement, text: string, yes: () => void): VbWindow {
  const win = new VbWindow(parent, { id: `confirm-${++counter}`, size: [340, 130], title: 'Confirmar' });
  const label = win.label(text, [16, 14, 308, 60]); label.style.whiteSpace = 'normal';
  win.command('Sí', [84, 88, 75, 25], () => { win.close(); yes(); });
  win.command('No', [181, 88, 75, 25], () => win.close());
  return win;
}

/** frmCerrar (from the X of frmMain): Menú principal sends Quit, Salir closes the client, Cancelar closes the form. */
export function showExit(parent: HTMLElement, actions: { menu(): void; exit(): void }): VbWindow {
  const win = new VbWindow(parent, { id: 'exit-window', art: 'desconectar', size: [216, 186], title: 'Desconectar' });
  artButton(win, 'boton-mainmenu', [42, 41, 132, 28], 'Menú principal', () => { win.close(); actions.menu(); });
  artButton(win, 'boton-salir', [43, 79, 132, 28], 'Salir', () => { win.close(); actions.exit(); });
  artButton(win, 'boton-cancelar', [42, 117, 132, 28], 'Cancelar', () => win.close());
  return win;
}

/** frmConnecting: the Marco bitmap, "Conectando al servidor" and a Cancelar button that drops the connection. */
export function showConnecting(parent: HTMLElement, cancel: () => void): VbWindow {
  const win = new VbWindow(parent, { id: 'connecting-window', size: [215, 185], title: 'Conectando' });
  win.root.classList.remove('vb-plain'); win.root.style.background = '#000';
  void loadInterface('Marco', false).then(url => { win.root.style.backgroundImage = `url("${url}")`; win.root.style.backgroundSize = '100% 100%'; }).catch(() => undefined);
  win.label('Conectando al servidor', [48, 56, 120, 17], 'vb-center vb-bold');
  artButton(win, 'boton-cancelar', [40, 128, 145, 25], 'Cancelar', () => { win.close(); cancel(); });
  return win;
}

/** Frmcarga: the "Cargando..." card (VentanaCargando.bmp, 161x106) while the map and the client resources load. */
export class LoadingCard {
  private readonly el = document.createElement('div');
  constructor(parent: HTMLElement) {
    this.el.id = 'loading-card'; this.el.hidden = true; this.el.textContent = 'Cargando...';
    void loadInterface('VentanaCargando').then(url => { this.el.style.backgroundImage = `url("${url}")`; }).catch(() => { this.el.style.background = '#101010'; });
    parent.append(this.el);
  }
  set visible(value: boolean) { this.el.hidden = !value; }
  get visible() { return !this.el.hidden; }
}

/** frmNewAccount (create account): 356x342 `ventanacrearcuenta`. In PYMMO=0 only the e-mail and password travel (WriteCreateAccount). */
export function showNewAccount(parent: HTMLElement, hooks: { create(email: string, password: string): void; say(text: string): void }): VbWindow {
  const win = new VbWindow(parent, { id: 'new-account-window', art: 'ventanacrearcuenta', size: [356, 342], title: 'Crear cuenta' });
  const field = (box: Box, label: string, type = 'text') => {
    const i = win.input([...box] as unknown as [number, number, number, number]) as HTMLInputElement;
    i.type = type; i.setAttribute('aria-label', label); i.style.background = '#131403'; i.style.color = '#c0c0c0'; i.style.font = 'bold 12px Tahoma, Arial';
    return i;
  };
  field([48, 107, 121, 17], 'Nombre'); field([189, 107, 121, 17], 'Apellido');
  const email = field([48, 158, 121, 17], 'Email'); email.autocomplete = 'username';
  const password = field([188, 158, 107, 17], 'Contraseña', 'password'); password.autocomplete = 'new-password';
  const eye = win.add(document.createElement('button'), [294, 158, 17, 17]); eye.type = 'button'; eye.className = 'vb-hotspot'; eye.setAttribute('aria-label', 'Ver contraseña');
  const reveal = (on: boolean) => { password.type = on ? 'text' : 'password'; };
  eye.addEventListener('pointerdown', () => reveal(true)); eye.addEventListener('pointerup', () => reveal(false)); eye.addEventListener('pointerleave', () => reveal(false));
  const a = 1 + Math.floor(Math.random() * 9), b = 1 + Math.floor(Math.random() * 9);
  win.label(`${a} + ${b}`, [80, 198, 55, 17], 'vb-bold');
  const captcha = field([144, 198, 73, 19], 'Captcha'); captcha.inputMode = 'numeric';
  const submit = () => {
    if (Number(captcha.value) !== a + b) { hooks.say(TEXT.captcha); captcha.value = ''; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) { hooks.say(TEXT.badEmail); return; }
    if (password.value.length < 4) { hooks.say('La contraseña debe tener al menos 4 caracteres.'); return; }
    hooks.create(email.value.trim(), password.value); win.close();
  };
  artButton(win, 'boton-crear-cuenta-rojo', [185, 242, 128, 26], 'Crear cuenta', submit);
  artButton(win, 'boton-cancelar', [43, 242, 129, 25], 'Cancelar', () => win.close());
  win.root.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  win.focus();
  return win;
}
