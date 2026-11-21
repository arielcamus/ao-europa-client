/*
 * Party (group) state, 2026-11-20, from the classic client Protocol.bas (HandleDatosGrupo, HandleUpdateGroupInfo,
 * Group.bas (frames drawn at the left of the map, Hide toggle) and FrmGrupo.frm. The invite question (ShowPregunta) is bank-trade's
 * overlay and the invite target click is the spells feature's WorkLeftClick. AGPL-3.0-or-later; no warranty. See NOTICE.
 */
import { PartyClientPacketId as PC, PartyServerPacketId as PS } from '@ao/protocol';
import type { ClientPacket, GroupFrameMember, ServerPacket } from '@ao/protocol';

/** Group.bas layout, in map pixels (the 736x608 renderer): frame size, first row and spacing. */
export const GROUP_FRAME = { startX: 10, startY: 250, spacingY: 60, width: 104, height: 32, hpBarStartX: 34, hpBarEndX: 99, hpBarStartY: 21 } as const;
/** Group.bas: a member name is cut to 10 characters. */
export const GROUP_NAME_MAX = 10;

export interface GroupMemberFrame extends GroupFrameMember {
  /** 1-based, the id WriteActionOnGroupFrame sends (Group.GroupMembers(i).GroupId = i + 1). */
  groupId: number;
  /** Top of the frame in map pixels (UpdateRenderArea); undefined for the player's own entry, which is not drawn. */
  top: number | undefined;
}
export interface PartyWindow { inGroup: boolean; members: string[] }

export class PartyState {
  /** Bumped on every visible change; the DOM layer redraws when it moves. */
  revision = 0;
  /** Group.GroupSize: values <= 1 draw nothing. */
  size = 0;
  members: GroupMemberFrame[] = [];
  /** FrmGrupo content while the window is open (HandleDatosGrupo shows it), else undefined. */
  window: PartyWindow | undefined;
  /** Group.Hide: the frames are slid out of the way. */
  hidden = false;
  /** The player's own char index, to skip the own frame like Group.UpdateRenderArea (set by the session). */
  selfCharIndex: number | undefined;

  receive(packet: ServerPacket): void {
    switch (packet.id) {
      case PS.DatosGrupo:
        this.window = { inGroup: packet.inGroup, members: packet.members }; this.revision++; break;
      case PS.UpdateGroupInfo: this.updateGroupInfo(packet.members); break;
      default: break;
    }
  }

  /** HandleUpdateGroupInfo: size <= 1 clears the frames; each frame is laid out like Group.UpdateRenderArea. */
  private updateGroupInfo(list: GroupFrameMember[]) {
    this.size = list.length;
    if (list.length <= 1) { this.members = []; this.revision++; return; }
    const startY = GROUP_FRAME.startY - (GROUP_FRAME.spacingY * (list.length - 1)) / 2;
    let drawn = 0;
    this.members = list.map((member, index) => {
      const own = member.charIndex === this.selfCharIndex;
      const top = own ? undefined : startY + GROUP_FRAME.spacingY * drawn++;
      return { ...member, name: member.name.slice(0, GROUP_NAME_MAX), groupId: index + 1, top };
    });
    this.revision++;
  }

  /** Group.RenderGroup draws every member but the player. */
  get frames(): GroupMemberFrame[] { return this.members.filter(member => member.top !== undefined && member.name !== ''); }



  toggleHidden(): void { this.hidden = !this.hidden; this.revision++; }
  closeWindow(): void { if (this.window) { this.window = undefined; this.revision++; } }

  /** modBindKeys eGroupList / frmMain Image5 click: ask for the member list unless the window is already open. */
  requestWindow(): ClientPacket | undefined { return this.window ? undefined : { id: PC.RequestGrupo }; }
  /** FrmGrupo.cmdAbandonar_Click. */
  leave(): ClientPacket { this.closeWindow(); return { id: PC.AbandonarGrupo }; }
  /** FrmGrupo.cmdExpulsar_Click: needs a selected row; the index is 0-based (lstGrupo.ListIndex). */
  expel(listIndex: number): ClientPacket | undefined {
    if (!this.window || listIndex < 0 || listIndex >= this.window.members.length) return undefined;
    this.closeWindow(); return { id: PC.HecharDeGrupo, index: listIndex };
  }
  /** FrmGrupo.cmdInvitar_Click: closes the window, then the server asks for a target. */
  invite(): ClientPacket { this.closeWindow(); return { id: PC.InvitarGrupo }; }
  /** Group.HandleMouseInput while a spell is being aimed: cast it on the member of that frame. */
  actOnFrame(groupId: number): ClientPacket | undefined {
    return this.members.some(m => m.groupId === groupId && m.top !== undefined) ? { id: PC.ActionOnGroupFrame, groupId } : undefined;
  }
  /** The frame under a map-pixel point, if the frames are visible (Group.HandleMouseInput). */
  frameAt(x: number, y: number): GroupMemberFrame | undefined {
    if (this.hidden) return undefined;
    return this.frames.find(m => m.top !== undefined && x >= GROUP_FRAME.startX && x <= GROUP_FRAME.startX + GROUP_FRAME.width && y >= m.top && y <= m.top + GROUP_FRAME.height);
  }
}
