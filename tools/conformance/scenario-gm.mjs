// GM scenario (wp12): Aotest is made an Admin in the VM's Server.ini (see the PR body), then this logs in and runs the GM commands.
// Packet ids are ClientPacketID of PacketId.bas (PYMMO=0); field order is the VB6 Write* order (Protocol_Writes.bas).
import { i32, str } from './wire.mjs';
const i16 = n => { const b = Buffer.alloc(2); b.writeInt16LE(n); return [...b]; };
const decoded = rec => rec.records.slice(rec.mark ?? 0).filter(r => r.dir === 's2c');
export default async function run(rec) {
  rec.mark = rec.records.length;
  const step = async (id, body = [], ms = 700) => { rec.send(id, body); await rec.sleep(ms); };
  // login already sent Privilegios (177) after Logged
  await step(38);                                   // /ONLINE            -> UserOnline (112)
  await step(112); await step(116);                 // /PANELGM           -> ShowSOSForm (108), ShowGMPanelForm (110)
  await step(117);                                  // RequestUserList    -> UserNameList (111)
  await step(140);                                  // /CC                -> SpawnListt (107)
  await step(178);                                  // /MOTDCAMBIA        -> ShowMOTDEditionForm (109)
  await step(107, str('Aotest'));                   // /DONDE Aotest      -> console location line
  await step(168, [...i16(38), ...i16(5)]);         // /CI 38 5           -> UpdateInventorySlot
  await step(123, [...str('Aotest'), 1, ...str('1000'), ...str('')]); // /MOD Aotest ORO 1000 -> UpdateGold
  await step(181, i16(501));                        // /ACC 501           -> CharacterCreate of the NPC next to us
  await step(130, str('Aotest'));                   // /REVIVIR Aotest    -> (alive: server says so)
  await step(110, [...str('Aotest'), ...i16(1), 60, 50]); // /TELEP Aotest 1 60 50 -> ChangePos / PosUpdate
  await step(115, [], 1000);                        // /INVISIBLE         -> SetInvisible / CharacterChange
  await step(115, [], 1000);                        // /INVISIBLE again   (visible)
  await step(121);                                  // /RMATA             -> KillNPC (needs a selected NPC; refused otherwise)
  await step(139, str('Aotest'));                   // /SUM Aotest
  await step(55);                                   // /INFORMACION
  console.log('server replies', [...new Set(decoded(rec).map(r => r.name))].join(' '));
}
