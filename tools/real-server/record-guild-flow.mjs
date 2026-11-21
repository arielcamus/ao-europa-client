// AGPL-3.0-or-later. Records a whole guild lifecycle against the VB6 server (docs/CONFORMANCE.md fixture format) with three sessions:
//   gm        Aotest (a GM): raises the levels and hands out the four foundation gems with /MOD and /DAR (nothing else is recorded from it).
//   leader    Wintest: founds the guild, reads the leader panel, opens the applicant's card, reads the application, rejects, accepts, kicks.
//   applicant Aotesta: lowercase GuildRequestDetails (case check), applies (upper case), is rejected, applies again, is accepted, reads the member news.
// Usage: AO_LEADER_EMAIL/PASSWORD/CHAR, AO_APPLICANT_EMAIL/PASSWORD/CHAR, AO_GM_EMAIL/PASSWORD/CHAR node tools/real-server/record-guild-flow.mjs <outdir>
// Undo: the applicant's level goes back to 1 at the end (/MOD LEVEL 1); the leader and its guild are throw-away test data (Wintest of windows@local.test).
import { Recorder } from '../conformance/vb6-record.mjs';
import { str, i32 } from '../conformance/wire.mjs';
import { decodeServerPacket, encodeClientPacket, GuildClientPacketId as G, GmClientPacketId as GM } from '../../packages/protocol/dist/index.js';

const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const outDir = process.argv[2]; if (!outDir) throw new Error('usage: record-guild-flow.mjs <outdir>');
const host = process.env.AO_HOST ?? '127.0.0.1', port = Number(process.env.AO_PORT ?? 7667);
const names = {};
async function login(prefix) {
  const rec = new Recorder(host, port);
  await rec.wait(r => r.id === 1);
  rec.send(305, [...str(need(`AO_${prefix}_EMAIL`)), ...str(need(`AO_${prefix}_PASSWORD`))]);
  const list = await rec.wait(r => r.id === 199);
  const chars = decodeServerPacket(Uint8Array.from(Buffer.from(list.hex, 'hex'))).characters;
  const pick = chars.find(c => c.name === need(`AO_${prefix}_CHAR`));
  rec.send(73, [...i32(pick.id), ...str(pick.name)]);
  await rec.wait(r => r.id === 2).catch(error => { console.error(`${need(`AO_${prefix}_CHAR`)}: no Logged (still online from an earlier run?)`); throw error; }); await rec.sleep(2500);
  names[prefix] = pick.name;
  return rec;
}
const send = (rec, packet) => rec.send(packet.id, [...encodeClientPacket(packet).slice(2)]);
const wait = ms => new Promise(r => setTimeout(r, ms));
const gm = await login('GM'), leader = await login('LEADER'), applicant = await login('APPLICANT');
const L = names.LEADER, A = names.APPLICANT;
try {
  if (process.env.AO_PHASE === 'accept') {
    // Second phase (the guild and a pending request exist from phase one): accepting costs the leader 500 gold (Msg2163).
    send(gm, { id: GM.EditChar, userName: L, editOption: 1, arg1: '1000', arg2: '' }); await wait(1000);
    send(applicant, { id: G.GuildRequestMembership, guild: 'WinGuild', application: 'Segunda solicitud' }); await wait(1500);
    send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1500);
    send(leader, { id: G.GuildMemberInfo, userName: A }); await wait(1500);
    send(leader, { id: G.GuildAcceptNewMember, userName: A }); await wait(2000);
    send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1500);
    send(applicant, { id: G.RequestGuildLeaderInfo }); await wait(1500);
    send(applicant, { id: G.GuildRequestDetails, guild: 'WinGuild' }); await wait(1200);
    send(leader, { id: G.GuildMemberInfo, userName: A }); await wait(1500);
    send(leader, { id: G.GuildKickMember, userName: A }); await wait(2000);
    send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1200);
    send(gm, { id: GM.EditChar, userName: L, editOption: 1, arg1: '0', arg2: '' }); await wait(800);
    send(gm, { id: GM.EditChar, userName: A, editOption: 7, arg1: '1', arg2: '' }); await wait(1000);
  } else {
  // ---- GM provisioning: level 23+ and Liderazgo 50 for the leader, the four gems, a high-enough level for the applicant ----
  send(gm, { id: GM.EditChar, userName: L, editOption: 7, arg1: '25', arg2: '' }); await wait(700);
  send(gm, { id: GM.EditChar, userName: L, editOption: 9, arg1: 'Liderazgo', arg2: '50' }); await wait(700);
  for (const obj of [407, 408, 409, 412]) { send(gm, { id: GM.GiveItem, userName: L, objIndex: obj, cantidad: 1, motivo: 'windows-test' }); await wait(700); }
  send(gm, { id: GM.EditChar, userName: A, editOption: 7, arg1: '25', arg2: '' }); await wait(1000);
  // ---- leader founds the guild ----
  send(leader, { id: G.QuieroFundarClan }); await wait(1500);
  send(leader, { id: G.CreateNewGuild, description: 'Clan de prueba para los formularios', name: 'WinGuild', alignment: 0 }); await wait(2000);
  send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1500);
  // ---- applicant: lowercase and uppercase names must both resolve (modGuilds.GuildIndex upper-cases both sides) ----
  send(applicant, { id: G.RequestGuildLeaderInfo }); await wait(1200);
  send(applicant, { id: G.GuildRequestDetails, guild: 'winguild' }); await wait(1200);
  send(applicant, { id: G.GuildRequestMembership, guild: 'WINGUILD', application: 'Quiero entrar al clan;º de prueba' }); await wait(1500);
  // ---- leader: panel with the request, the applicant's card, the application text, reject ----
  send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1500);
  send(leader, { id: G.GuildMemberInfo, userName: A }); await wait(1500);
  send(leader, { id: G.GuildRequestJoinerInfo, userName: A }); await wait(1500);
  send(leader, { id: G.GuildRejectNewMember, userName: A, reason: 'Todavia no' }); await wait(1500);
  send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1200);
  // ---- applicant tries again, leader accepts ----
  send(applicant, { id: G.GuildRequestMembership, guild: 'WinGuild', application: 'Vuelvo a intentar' }); await wait(1500);
  send(leader, { id: G.GuildAcceptNewMember, userName: A }); await wait(1500);
  send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1500);
  // ---- member side: the news window (frmGuildNews), another guild's details, the list ----
  send(applicant, { id: G.RequestGuildLeaderInfo }); await wait(1500);
  send(applicant, { id: G.GuildRequestDetails, guild: 'WinGuild' }); await wait(1200);
  // ---- leader: member card (Echar) and kick ----
  send(leader, { id: G.GuildMemberInfo, userName: A }); await wait(1500);
  send(leader, { id: G.GuildKickMember, userName: A }); await wait(1500);
  send(leader, { id: G.RequestGuildLeaderInfo }); await wait(1200);
  // ---- undo on the applicant ----
  send(gm, { id: GM.EditChar, userName: A, editOption: 7, arg1: '1', arg2: '' }); await wait(1000);
  }
} finally {
  leader.save(`${outDir}/guild-${process.env.AO_PHASE === 'accept' ? 'accept' : 'flow'}-leader.jsonl`); applicant.save(`${outDir}/guild-${process.env.AO_PHASE === 'accept' ? 'accept' : 'flow'}-applicant.jsonl`);
  console.log(`saved leader ${leader.records.length} / applicant ${applicant.records.length} packets`);
  for (const r of [gm, leader, applicant]) r.close();
}
process.exit(0);
