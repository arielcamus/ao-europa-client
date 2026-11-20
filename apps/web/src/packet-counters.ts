/*
 * Per-session packet counters, one per VB6 PacketNames family (Declares.bas). The server runs verifyTimeStamp on the counter of
 * each family; the client (Protocol_Writes.bas) keeps them in packetCounters.TS_* for the whole connection. They are never reset
 * on a map change and only advance when a packet is actually sent. AGPL-3.0-or-later; see ../../../LICENSE.
 */
export const PACKET_FAMILIES = [
  'castSpell', 'workLeftClick', 'leftClick', 'useItem', 'useItemU', 'walk', 'sailing', 'talk', 'attack', 'drop', 'work',
  'equipItem', 'guildMessage', 'questionGM', 'changeHeading', 'hide', 'targetedSpellCast',
] as const;
export type PacketFamily = (typeof PACKET_FAMILIES)[number];

export class PacketCounters {
  private readonly counts = new Map<PacketFamily, number>();
  /** The next counter value of a family (1, 2, 3, ...). Call only when the packet is really sent. */
  next(family: PacketFamily): number { const value = (this.counts.get(family) ?? 0) + 1; this.counts.set(family, value); return value; }
  current(family: PacketFamily): number { return this.counts.get(family) ?? 0; }
}

/**
 * Client packets whose Int32 counter the VB6 server reads (Protocol.bas VerifyPacketSequence / verifyTimeStamp; Drop, EquipItem and
 * CastSpell are read but not checked) and the family that counts it (client Protocol_Writes.bas packetCounters.TS_*). The server closes
 * the socket when a checked counter does not increase, so these counters MUST come from the session's one PacketCounters:
 * Session.send refuses any of these ids whose counter was not just issued by session.next(family).
 * Ids from server PacketId.bas ClientPacketID (PYMMO=0).
 */
export const SEQUENCED_CLIENT_PACKETS: Readonly<Record<number, PacketFamily>> = {
  2: 'workLeftClick', 5: 'equipItem', 6: 'changeHeading', 59: 'guildMessage', 75: 'talk', 78: 'walk', 80: 'attack',
  93: 'drop', 94: 'castSpell', 95: 'leftClick', 97: 'work', 99: 'useItem', 215: 'questionGM', 288: 'useItemU', 314: 'targetedSpellCast',
};
