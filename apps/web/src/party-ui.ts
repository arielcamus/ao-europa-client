/*
 * Party DOM layer: the member frames at the left of the map (Group.bas RenderGroup) and the FrmGrupo window. The invite question
 * is bank-trade's Pregunta overlay (trade-ui.ts).
 * Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later; see NOTICE. Art is read only from the local mount.
 */
import type { ClientPacket } from '@ao/protocol';
import { GROUP_FRAME } from './party.js';
import type { GroupMemberFrame } from './party.js';
import type { Session } from './session.js';
import type { WorldRenderer } from './renderer.js';
import { grhCanvas, headCanvas } from './grh-canvas.js';
import { VbWindow } from './vb-window.js';
import type { VbList } from './vb-window.js';

/** Group.bas Grh indexes: frame background and the two arrows of the hide/show tab. */
export const GROUP_GRH = { background: 29335, hideArrow: 29548, showArrow: 29549 } as const;

export class PartyUI {
  private readonly frames = document.createElement('div');
  private window: VbWindow | undefined;
  private members: VbList | undefined;
  private revision = -1;
  private session: Session | undefined;
  private generation = 0;
  private slide = 0;
  private slideTimer: number | undefined;
  /** Group.HandleMouseInput: a frame was clicked while a spell is being aimed (spells feature hooks this; sends ActionOnGroupFrame). */
  onFrameClick: ((groupId: number) => void) | undefined;

  constructor(private readonly viewport: HTMLElement, private readonly classic: HTMLElement, private readonly renderer: WorldRenderer, private readonly send: (packet: ClientPacket | undefined) => void) {
    this.frames.id = 'group-frames';
    // Clicks on the frames are theirs, not a map click.
    this.frames.addEventListener('pointerdown', event => event.stopPropagation());
    viewport.append(this.frames);
  }

  update(session: Session | undefined) {
    if (session !== this.session) { this.session = session; this.revision = -1; this.window?.close(); this.window = undefined; }
    if (!session) { this.frames.replaceChildren(); return; }
    const party = session.party;
    if (party.revision === this.revision) return;
    this.revision = party.revision;
    void this.drawFrames(session).catch(() => undefined);
    this.syncWindow(session);
  }

  /** Group.RenderGroup, as DOM: background art, head, HP bar and name per member, plus the hide/show tab. */
  private async drawFrames(session: Session) {
    const generation = ++this.generation, party = session.party;
    const rows = party.frames;
    if (!rows.length) { this.frames.replaceChildren(); return; }
    const [background, hide, show] = await Promise.all([grhCanvas(this.renderer, GROUP_GRH.background), grhCanvas(this.renderer, GROUP_GRH.hideArrow), grhCanvas(this.renderer, GROUP_GRH.showArrow)]);
    const heads = await Promise.all(rows.map(member => headCanvas(this.renderer, member.head).catch(() => undefined)));
    if (generation !== this.generation) return;
    const offset = party.hidden ? -(GROUP_FRAME.width + GROUP_FRAME.startX) : 0; // Group.CurrentPivot
    const nodes = rows.map((member, i) => this.frame(member, background, heads[i], offset));
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = 'group-tab'; tab.title = party.hidden ? 'Mostrar grupo' : 'Ocultar grupo';
    tab.setAttribute('aria-label', tab.title);
    tab.style.left = `${GROUP_FRAME.startX - 5 - 2}px`; tab.style.top = `${GROUP_FRAME.startY - 20}px`;
    tab.append(party.hidden ? hide : show);
    tab.addEventListener('click', () => party.toggleHidden());
    this.frames.replaceChildren(...nodes, tab);
  }
  private frame(member: GroupMemberFrame, background: HTMLCanvasElement, head: HTMLCanvasElement | undefined, offset: number) {
    const node = document.createElement('div'); node.className = 'group-frame'; node.dataset.groupId = String(member.groupId);
    node.style.left = `${GROUP_FRAME.startX + offset}px`; node.style.top = `${member.top}px`;
    const art = document.createElement('canvas'); art.width = background.width; art.height = background.height; art.getContext('2d')!.drawImage(background, 0, 0);
    node.append(art);
    if (head) {
      // Group.RenderGroup: Draw_Grh(head south, Left, Top + 28, center): x + 16 - width / 2, y + 32 - height.
      head.className = 'group-head'; head.style.left = `${16 - Math.floor(head.width / 2)}px`; head.style.top = `${28 + 32 - head.height}px`;
      node.append(head);
    }
    // Shield is not part of PrepareUpdateGroupInfo, so the bar is minHp / maxHp (Group.bas: MinHp / (MaxHp + Shield)).
    const bar = document.createElement('div'); bar.className = 'group-hp';
    const width = GROUP_FRAME.hpBarEndX - GROUP_FRAME.hpBarStartX;
    bar.style.left = `${GROUP_FRAME.hpBarStartX}px`; bar.style.top = `${GROUP_FRAME.hpBarStartY}px`;
    bar.style.width = `${member.maxHp > 0 ? Math.max(0, Math.min(1, member.minHp / member.maxHp)) * width : 0}px`;
    const name = document.createElement('span'); name.className = 'group-name'; name.textContent = member.name; name.title = `${member.name} ${member.minHp}/${member.maxHp}`;
    node.append(bar, name);
    node.addEventListener('click', () => this.onFrameClick?.(member.groupId));
    return node;
  }

  /** FrmGrupo: opened by DatosGrupo (the answer to RequestGrupo), closed by every button and by Escape. */
  private syncWindow(session: Session) {
    const party = session.party;
    if (!party.window) { if (this.window) { const w = this.window; this.window = undefined; w.close(); } return; }
    if (!this.window) {
      const win = new VbWindow(this.classic, { id: 'frm-grupo', art: 'ventanagrupo', size: [433, 434], title: 'Grupo', onClose: () => { if (this.window === win) this.window = undefined; party.closeWindow(); } });
      this.window = win;
      this.members = win.list([240, 136, 153, 142]);
      win.button('boton-aceptar', [235, 382, 132, 28], 'Aceptar', () => win.close());
      win.button('boton-abandonar', [67, 382, 132, 28], 'Abandonar', () => this.send(party.leave()));
      win.closeButton([402, 1, 31, 28]);
      win.button('boton-menos', [279, 311, 31, 28], 'Expulsar', () => { const packet = party.expel(this.members?.index ?? -1); if (packet) this.send(packet); });
      win.button('boton-mas', [321, 311, 31, 28], 'Invitar', () => this.send(party.invite()));
    }
    this.members?.set(party.window.members);
  }

  /** frmMain.renderer_MouseDown: a click on the map unloads FrmGrupo. */
  closeWindow() { this.window?.close(); }
  get windowOpen() { return !!this.window?.isOpen; }
}
