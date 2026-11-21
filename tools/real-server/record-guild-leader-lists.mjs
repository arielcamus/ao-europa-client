// AGPL-3.0-or-later. Records the leader-only guild requests that frmGuildLeader.frm has handlers for but no control (cmdElecciones, Command7 = peace list,
// Command9 = alliance list) plus /VOTO, against the VB6 server, as the leader of the throw-away guild WinGuild (Wintest, windows@local.test).
// Read-only requests plus two refusals on names that do not exist (nothing persistent). GuildOpenElections is NOT sent: it opens a real election.
// Usage: AO_EMAIL=windows@local.test AO_PASSWORD=... AO_CHAR=Wintest node tools/real-server/record-guild-leader-lists.mjs <out.jsonl>
import { Recorder } from '../conformance/vb6-record.mjs';
import { str, i32 } from '../conformance/wire.mjs';
import { decodeServerPacket, encodeClientPacket, GuildClientPacketId as G } from '../../packages/protocol/dist/index.js';
const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const out = process.argv[2]; if (!out) throw new Error('usage: <out.jsonl>');
const rec = new Recorder('127.0.0.1', Number(process.env.AO_PORT ?? 7667));
await rec.wait(r => r.id === 1);
rec.send(305, [...str(need('AO_EMAIL')), ...str(need('AO_PASSWORD'))]);
const list = await rec.wait(r => r.id === 199);
const pick = decodeServerPacket(Uint8Array.from(Buffer.from(list.hex, 'hex'))).characters.find(c => c.name === need('AO_CHAR'));
rec.send(73, [...i32(pick.id), ...str(pick.name)]);
await rec.wait(r => r.id === 2); await rec.sleep(2500);
const send = packet => rec.send(packet.id, [...encodeClientPacket(packet).slice(2)]);
const step = async (label, packet) => { const mark = rec.records.length; send(packet); await rec.sleep(1500); console.log(label, rec.records.slice(mark).filter(r => r.dir === 's2c').map(r => `${r.id}:${r.name}`).join(' ')); };
await step('RequestGuildLeaderInfo', { id: G.RequestGuildLeaderInfo });
await step('GuildPeacePropList', { id: G.GuildPeacePropList });
await step('GuildAlliancePropList', { id: G.GuildAlliancePropList });
await step('GuildDeclareWar(no such guild)', { id: G.GuildDeclareWar, guild: 'NoSuchGuildWpA' });
await step('GuildVote(no election)', { id: G.GuildVote, userName: 'NoSuchCharWpA' });
rec.save(out); rec.close(); process.exit(0);
