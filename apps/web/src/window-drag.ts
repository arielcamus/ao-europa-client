/*
 * Drag a form by its background, the web stand-in for the VB6 `MoverForm hWnd` that FrmEstadisticas, FrmQuest and frmQuestInfo call in
 * Form_MouseDown (ReleaseCapture + WM_NCLBUTTONDOWN on HTCAPTION). Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE.
 * The form is positioned with `left` / `top` in the 1024x768 classic stage; it is kept inside it.
 */
const INTERACTIVE = 'button, input, textarea, select, a, [role="listbox"], [role="option"], .q-table, .q-main-list, .sk-msgbox, .q-msgbox';

/** The new left/top of a form of `size` dragged by (dx, dy) from `start`, clamped to the stage so the form cannot be lost off screen. */
export function dragPosition(start: { x: number; y: number }, delta: { x: number; y: number }, size: { width: number; height: number }, stage = { width: 1024, height: 768 }) {
  const clamp = (value: number, max: number) => Math.min(Math.max(0, max), Math.max(0, value));
  return { x: clamp(start.x + delta.x, stage.width - size.width), y: clamp(start.y + delta.y, stage.height - size.height) };
}

export function makeDraggable(root: HTMLElement): void {
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target as HTMLElement | null)?.closest(INTERACTIVE)) return;
    const scale = root.parentElement ? root.parentElement.getBoundingClientRect().width / 1024 || 1 : 1;
    const start = { x: root.offsetLeft, y: root.offsetTop }, origin = { x: event.clientX, y: event.clientY };
    const size = { width: root.offsetWidth, height: root.offsetHeight };
    const move = (e: PointerEvent) => {
      const next = dragPosition(start, { x: (e.clientX - origin.x) / scale, y: (e.clientY - origin.y) / scale }, size);
      root.style.left = `${next.x}px`; root.style.top = `${next.y}px`;
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    event.preventDefault();
  });
}
