/*
 * Combat status of the player and of other characters, adapted 2026-11-21 from the classic client Protocol.bas:
 * HandleBlind/BlindNoMore, HandleDumb/DumbNoMore, HandleParalizeOK, HandleInmovilizadoOK, HandleStunStart, HandleStopped,
 * HandleSetInvisible, HandlePartySafeOn/Off, HandleClanSeguro, HandleSeguroResu, HandleLegionarySecure, HandleNPCKillUser,
 * HandleBlockedWithShield*, HandleBarFx, HandleEscudoMov, HandleDoAnimation, HandleUpdateTrapState, HandleUpdateCooldownType,
 * HandleCharUpdateMAN, plus Declares.CanMove and General.MoveTo. Copyright (C) 2022-2026 Noland Studios. AGPL-3.0-or-later;
 * no warranty. See NOTICE.
 */
import { ServerPacketId as S, StatusServerPacketId as SS } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';

/** FontTypeNames used by these handlers (chat-fonts.ts rows): FIGHT = red bold, INFO = (65,190,156), PARTY_SAFE = (250,250,0) italic. */
export const STATUS_FONT = { FIGHT: 1, INFO: 3, PARTY_SAFE: 44 } as const;
/** Languages/1.json, Spanish. */
export const STATUS_TEXT = {
  npcKill: 'La criatura te ha matado!!!',
  shieldBlockSelf: 'Has rechazado el ataque con el escudo.',
  shieldBlockOther: 'El usuario rechazo el ataque con su escudo.',
  partyOn: 'Ahora nadie te podrá invitar a un grupo.',
  partyOff: 'Ahora podrás recibir solicitudes a grupos.',
  clanOn: 'Seguro de clan activado.', clanOff: 'Seguro de clan desactivado.',
  resuOn: 'Seguro de resurrección activado.', resuOff: 'Seguro de resurrección desactivado.',
  legionOn: 'Has activado el seguro de Facción Legionaria.',
  legionOff: 'Has desactivado el seguro de Facción Legionaria, ahora puedes atacar a un Legión.',
  legionDisabled: 'El seguro de facción Legionaria se encuentra deshabilitado temporalmente.',
} as const;
/** engine.bas Char_Render: an invisible character the viewer may see is drawn with alpha 100 of 255. */
export const INVISIBLE_ALPHA = 100 / 255;
/** TileEngine.bas Trap grh (HandleUpdateTrapState) and its draw alpha. */
export const TRAP_GRH = 38370;
export const TRAP_ALPHA = 100 / 255;

export interface TimedBar { action: number; maxSeconds: number; shown: number }
type Say = (text: string, font: number) => void;

export class StatusState {
  blind = false;
  dumb = false;
  paralyzed = false;
  immobilized = false;
  stopped = false;
  stunEnd = -Infinity;
  stunTotal = 0;
  /** Seguro de grupo / clan / resurrección / legión; all four are on after Logged (HandleLogged). */
  partySafe = true; clanSafe = true; resuSafe = true; legionSafe = true;
  invisible = new Set<number>();
  bars = new Map<number, TimedBar>();
  traps = new Set<number>();
  /** CdTimes(type): when the server last started that cooldown type. */
  cooldownStart = new Map<number, number>();
  /** Other characters' mana (HandleCharUpdateMAN; clan members and GMs only). */
  mana = new Map<number, { mana: number; maxMana: number }>();
  /** DoAnimation: the body a character shows while casting. */
  animating = new Map<number, number>();
  /** EscudoMov: shield swing start, drawing it needs shield art that is not animated yet. */
  shieldSwings = new Map<number, number>();
  revision = 0;

  constructor(private readonly say: Say, private readonly clock: () => number) {}

  /** Declares.CanMove. */
  canMove(now = this.clock()): boolean { return !this.paralyzed && !this.immobilized && !(this.stunEnd >= now) && !this.stopped; }
  get stunned() { return this.stunEnd >= this.clock(); }
  /** Alpha to draw a character with, or undefined when it must not be drawn (invisible and not visible to us). */
  alphaOf(charIndex: number, selfIndex: number | undefined, privileged = false): number | undefined {
    if (!this.invisible.has(charIndex)) return 1;
    return charIndex === selfIndex || privileged ? INVISIBLE_ALPHA : undefined;
  }
  hasTrap(x: number, y: number) { return this.traps.has(y * 256 + x); }
  /** ImgSegClan/Resu click answers: the toggle packets carry the new state, the safes start on at login. */
  private bump() { this.revision++; }

  receive(packet: ServerPacket, onBlind: (blind: boolean) => void): void {
    const say = this.say;
    switch (packet.id) {
      case S.Logged: this.blind = false; this.partySafe = this.clanSafe = this.resuSafe = this.legionSafe = true; onBlind(false); this.bump(); break;
      case S.ChangeMap: this.bars.clear(); this.traps.clear(); this.invisible.clear(); this.animating.clear(); break;
      case SS.NPCKillUser: say(STATUS_TEXT.npcKill, STATUS_FONT.FIGHT); break;
      case SS.BlockedWithShieldUser: say(STATUS_TEXT.shieldBlockSelf, STATUS_FONT.FIGHT); break;
      case SS.BlockedWithShieldOther: say(STATUS_TEXT.shieldBlockOther, STATUS_FONT.FIGHT); break;
      case SS.PartySafeOn: this.partySafe = true; say(STATUS_TEXT.partyOn, STATUS_FONT.PARTY_SAFE); this.bump(); break;
      case SS.PartySafeOff: this.partySafe = false; say(STATUS_TEXT.partyOff, STATUS_FONT.PARTY_SAFE); this.bump(); break;
      // HandleClanSeguro ignores its Boolean and flips the local flag (SeguroClanX).
      case SS.ClanSeguro:
        this.clanSafe = !this.clanSafe; say(this.clanSafe ? STATUS_TEXT.clanOn : STATUS_TEXT.clanOff, STATUS_FONT.INFO); this.bump(); break;
      case SS.SeguroResu: this.resuSafe = packet.enabled; say(packet.enabled ? STATUS_TEXT.resuOn : STATUS_TEXT.resuOff, STATUS_FONT.INFO); this.bump(); break;
      case SS.LegionarySecure: this.legionSafe = packet.enabled; say(packet.enabled ? STATUS_TEXT.legionOn : STATUS_TEXT.legionOff, STATUS_FONT.INFO); this.bump(); break;
      case SS.Blind: this.blind = true; onBlind(true); this.bump(); break;
      case SS.BlindNoMore: this.blind = false; onBlind(false); this.bump(); break;
      case SS.Dumb: this.dumb = true; break;
      case SS.DumbNoMore: this.dumb = false; break;
      // ParalizeOK / InmovilizadoOK are toggles in the VB6 client (Not UserParalizado).
      case SS.ParalizeOK: this.paralyzed = !this.paralyzed; this.bump(); break;
      case SS.InmovilizadoOK: this.immobilized = !this.immobilized; this.bump(); break;
      case SS.StunStart: this.stunTotal = packet.duration; this.stunEnd = this.clock() + packet.duration; this.bump(); break;
      case SS.Stopped: this.stopped = packet.stopped; this.bump(); break;
      case SS.SetInvisible:
        if (packet.invisible) this.invisible.add(packet.charIndex); else this.invisible.delete(packet.charIndex);
        this.bump(); break;
      case SS.UpdateCooldownType: this.cooldownStart.set(packet.cdType, this.clock()); break;
      case SS.CharUpdateMAN: this.mana.set(packet.charIndex, { mana: packet.mana, maxMana: packet.maxMana }); break;
      case SS.BarFx:
        if (packet.barTime > 0) this.bars.set(packet.charIndex, { action: packet.action, maxSeconds: packet.barTime, shown: 0 });
        else this.bars.delete(packet.charIndex);
        break;
      case SS.EscudoMov: this.shieldSwings.set(packet.charIndex, this.clock()); break;
      case SS.DoAnimation: this.animating.set(packet.charIndex, packet.animation); break;
      case SS.UpdateTrap: {
        const key = packet.y * 256 + packet.x;
        if (packet.state > 0) this.traps.add(key); else this.traps.delete(key);
        break;
      }
      default: break;
    }
  }
  /**
   * ModLogin.LoadCharacterSelectionScreen (frmMain visible): UserParalizado / UserInmovilizado / UserStopped = False. The issue also asks for the stun
   * timer, which VB6 leaves to expire. Done when the session goes back to the account screen, NOT on Logged: the server sends ParalizeOK
   * while logging in a paralysed character and a reset on Logged would wipe it (the toggle packets are not idempotent).
   */
  resetOnLeave() {
    this.paralyzed = this.immobilized = this.stopped = false; this.stunEnd = -Infinity; this.stunTotal = 0; this.blind = false; this.dumb = false;
    this.bump();
  }
  /** Characters leaving the map drop their effects. */
  forget(charIndex: number) {
    this.invisible.delete(charIndex); this.bars.delete(charIndex); this.mana.delete(charIndex);
    this.animating.delete(charIndex); this.shieldSwings.delete(charIndex);
  }
}
