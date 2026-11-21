import { describe, expect, it } from 'vitest';
import { SessionServerPacketId, ClientPacketId as C, ServerPacketId as S, Heading, StatusClientPacketId as SC, StatusServerPacketId as SS, encodeServerFrame, decodeClientPacket, FrameDecoder } from '@ao/protocol';
import type { ServerPacket } from '@ao/protocol';
import { serverFixtures as f } from '../../../packages/protocol/test/fixtures.js';
import { Session } from '../src/session.js';
import { INVISIBLE_ALPHA, STATUS_TEXT } from '../src/status.js';

function harness(beforeLogged: ServerPacket[] = []) {
  let now = 0;
  const sent: Uint8Array[] = [];
  const session = new Session({ email: 'test', password: 'secret' }, bytes => sent.push(bytes), () => now);
  const recv = (...packets: ServerPacket[]) => { for (const packet of packets) session.receive(encodeServerFrame(packet)); };
  recv(f.Connected, f.AccountCharacterList, f.Intervals, f.ChangeMap, { ...f.CharacterCreate, speeding: 1 }, f.UserCharIndexInServer, ...beforeLogged, f.Logged);
  const out = () => { const d = new FrameDecoder(); return sent.flatMap(b => d.push(b).map(decodeClientPacket)); };
  return { session, recv, sent, out, advance: (ms: number) => { now += ms; }, last: () => session.ui.messages.at(-1) };
}
const SELF = f.CharacterCreate.charIndex;

describe('combat status (VB6 Protocol.bas handlers)', () => {
  it('Blind sets world.blind (the light), BlindNoMore restores it', () => {
    const h = harness();
    h.recv({ id: SS.Blind }); expect(h.session.status.blind).toBe(true); expect(h.session.world.blind).toBe(true);
    h.recv({ id: SS.BlindNoMore }); expect(h.session.status.blind).toBe(false); expect(h.session.world.blind).toBe(false);
  });
  it('ParalizeOK and InmovilizadoOK are toggles, and CanMove blocks the walk packet', () => {
    const h = harness();
    h.recv({ id: SS.ParalizeOK }); expect(h.session.status.paralyzed).toBe(true);
    expect(h.session.walk(Heading.East)).toBe(false);
    expect(h.out().filter(p => p.id === C.Walk)).toHaveLength(0);
    h.recv({ id: SS.ParalizeOK }); expect(h.session.status.paralyzed).toBe(false);
    h.recv({ id: SS.InmovilizadoOK }); expect(h.session.walk(Heading.East)).toBe(false);
    h.recv({ id: SS.InmovilizadoOK }); expect(h.session.walk(Heading.East)).toBe(true);
  });
  it('StunStart blocks movement until its duration passes; Stopped blocks while true', () => {
    const h = harness();
    h.recv({ id: SS.StunStart, duration: 1000 }); expect(h.session.walk(Heading.East)).toBe(false);
    h.advance(1001); expect(h.session.status.canMove()).toBe(true);
    h.recv({ id: SS.Stopped, stopped: true }); expect(h.session.walk(Heading.East)).toBe(false);
    h.recv({ id: SS.Stopped, stopped: false }); expect(h.session.walk(Heading.East)).toBe(true);
  });
  it('Dumb sends another heading when the roll is below 50, and keeps it otherwise', () => {
    const h = harness(); h.recv({ id: SS.Dumb });
    h.session.random = () => 0.1; // roll 11 < 50: a different heading, never the pressed one
    expect(h.session.walk(Heading.East)).toBe(true);
    expect(h.out().find(p => p.id === C.Walk)).not.toMatchObject({ heading: Heading.East });
    const k = harness(); k.recv({ id: SS.Dumb }); k.session.random = () => 0.9;
    expect(k.session.walk(Heading.East)).toBe(true); expect(k.out().find(p => p.id === C.Walk)).toMatchObject({ heading: Heading.East });
    k.recv({ id: SS.DumbNoMore }); expect(k.session.status.dumb).toBe(false);
  });
  it('going back to the account screen resets paralysed/immobilised/stopped/stun (ModLogin.LoadCharacterSelectionScreen); Logged does not', () => {
    const h = harness(); const s = h.session.status;
    h.recv({ id: SS.ParalizeOK }, { id: SS.InmovilizadoOK }, { id: SS.Stopped, stopped: true }, { id: SS.StunStart, duration: 30_000 });
    expect(s.canMove()).toBe(false);
    h.recv({ id: SessionServerPacketId.MostrarCuenta });
    expect([s.paralyzed, s.immobilized, s.stopped, s.stunned]).toEqual([false, false, false, false]);
    // A paralysed login: ParalizeOK arrives before Logged and must survive it (the packet is a toggle).
    const k = harness([{ id: SS.ParalizeOK }]);
    expect(k.session.status.paralyzed).toBe(true);
  });
  it('SetInvisible: drawn at alpha 100/255 for the viewer itself, hidden for others', () => {
    const h = harness(); const s = h.session.status;
    h.recv({ id: SS.SetInvisible, charIndex: SELF, invisible: true, x: 0, y: 0 }, { id: SS.SetInvisible, charIndex: 77, invisible: true, x: 0, y: 0 });
    expect(s.alphaOf(SELF, SELF, true)).toBeCloseTo(INVISIBLE_ALPHA); expect(s.alphaOf(77, SELF)).toBeUndefined();
    h.recv({ id: SS.SetInvisible, charIndex: SELF, invisible: false, x: 0, y: 0 }); expect(s.alphaOf(SELF, SELF, true)).toBe(1);
  });
  it('console lines use the VB6 text', () => {
    const h = harness();
    h.recv({ id: SS.NPCKillUser }); expect(h.last()).toMatchObject({ text: STATUS_TEXT.npcKill, font: 1 });
    h.recv({ id: SS.BlockedWithShieldUser }); expect(h.last()?.text).toBe('Has rechazado el ataque con el escudo.');
    h.recv({ id: SS.BlockedWithShieldOther }); expect(h.last()?.text).toBe('El usuario rechazo el ataque con su escudo.');
    h.recv({ id: SS.PartySafeOff }); expect(h.last()).toMatchObject({ text: 'Ahora podrás recibir solicitudes a grupos.', font: 44 }); expect(h.session.status.partySafe).toBe(false);
    h.recv({ id: SS.PartySafeOn }); expect(h.session.status.partySafe).toBe(true);
    h.recv({ id: SS.SeguroResu, enabled: false }); expect(h.last()?.text).toBe('Seguro de resurrección desactivado.');
    h.recv({ id: SS.LegionarySecure, enabled: true }); expect(h.last()?.text).toBe('Has activado el seguro de Facción Legionaria.');
  });
  it('ClanSeguro flips the local flag whatever its Boolean says (HandleClanSeguro)', () => {
    const h = harness();
    h.recv({ id: SS.ClanSeguro, enabled: true }); expect(h.session.status.clanSafe).toBe(false); expect(h.last()?.text).toBe('Seguro de clan desactivado.');
    h.recv({ id: SS.ClanSeguro, enabled: true }); expect(h.session.status.clanSafe).toBe(true);
  });
  it('safe buttons send the toggle packets; the legion one only prints that it is disabled', () => {
    const h = harness();
    expect(h.session.toggleSafe('clan')).toBe(true); expect(h.session.toggleSafe('resu')).toBe(true);
    expect(h.out().filter(p => p.id === SC.SeguroClan || p.id === SC.SeguroResu).map(p => p.id)).toEqual([SC.SeguroClan, SC.SeguroResu]);
    const before = h.sent.length; h.session.toggleSafe('legion');
    expect(h.sent.length).toBe(before); expect(h.last()?.text).toBe(STATUS_TEXT.legionDisabled);
  });
  it('BarFx starts a bar, EscudoMov/UpdateTrap/CharUpdateMAN/UpdateCooldownType keep their state, ChangeMap clears bars and traps', () => {
    const h = harness(); const s = h.session.status;
    h.recv({ id: SS.BarFx, charIndex: SELF, barTime: 7, action: 2 }); expect(s.bars.get(SELF)).toMatchObject({ maxSeconds: 7, action: 2 });
    h.recv({ id: SS.UpdateTrap, state: 1, x: 40, y: 50 }); expect(s.hasTrap(40, 50)).toBe(true);
    h.recv({ id: SS.UpdateTrap, state: 0, x: 40, y: 50 }); expect(s.hasTrap(40, 50)).toBe(false);
    h.recv({ id: SS.CharUpdateMAN, charIndex: 9, mana: 12, maxMana: 40 }); expect(s.mana.get(9)).toEqual({ mana: 12, maxMana: 40 });
    h.recv({ id: SS.UpdateCooldownType, cdType: 3 }); expect(s.cooldownStart.has(3)).toBe(true);
    h.recv({ id: SS.EscudoMov, charIndex: SELF }); expect(s.shieldSwings.has(SELF)).toBe(true);
    h.recv({ id: SS.DoAnimation, charIndex: SELF, animation: 829 }); expect(s.animating.get(SELF)).toBe(829);
    h.recv({ id: S.ChangeMap, map: 2, resourceMap: 2 }); expect(s.bars.size).toBe(0);
  });
});
