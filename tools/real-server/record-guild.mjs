// AGPL-3.0-or-later. Records the guild requests a level-1 character without a guild can make against the VB6 server (docs/CONFORMANCE.md
// fixture format): the guild list (RequestGuildLeaderInfo), founding refused (QuieroFundarClan: level 23 + 4 gems needed), details of and a
// membership request to a guild that does not exist, leaving without a guild, and the leader-only requests refused.
// Usage: AO_EMAIL=.. AO_PASSWORD=.. [AO_CHAR=Name] node tools/real-server/record-guild.mjs <out.jsonl>
import { Recorder } from '../conformance/vb6-record.mjs';
import { str, i32 } from '../conformance/wire.mjs';
import { decodeServerPacket } from '../../packages/protocol/dist/index.js';

const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const out = process.argv[2]; if (!out) throw new Error('usage: record-guild.mjs <out.jsonl>');
const rec = new Recorder(process.env.AO_HOST ?? '127.0.0.1', Number(process.env.AO_PORT ?? 7667));
try {
  await rec.wait(r => r.id === 1);
  rec.send(305, [...str(need('AO_EMAIL')), ...str(need('AO_PASSWORD'))]);
  const list = await rec.wait(r => r.id === 199);
  const chars = decodeServerPacket(Uint8Array.from(Buffer.from(list.hex, 'hex'))).characters;
  const pick = chars.find(c => c.name === (process.env.AO_CHAR ?? chars[0].name));
  rec.send(73, [...i32(pick.id), ...str(pick.name)]);
  await rec.wait(r => r.id === 2); await rec.sleep(2000);
  const ask = async (id, body = [], ms = 1200) => { rec.send(id, body); await rec.sleep(ms); };
  await ask(84);                                          // RequestGuildLeaderInfo -> GuildList (no guild yet)
  await ask(254);                                         // QuieroFundarClan -> refused (level / gems)
  await ask(37, str('Guild That Does Not Exist'));        // GuildRequestDetails
  await ask(36, [...str('Guild That Does Not Exist'), ...str('hola')]); // GuildRequestMembership
  await ask(40);                                          // GuildLeave without a guild
  await ask(34, str('Nobody'));                           // GuildMemberInfo (leader only)
  await ask(26); await ask(27);                           // GuildAlliancePropList / GuildPeacePropList (leader only)
  await ask(255); await ask(256);                         // Llamadadeclan / MarcaDeClanPack without a guild
} finally { rec.save(out); rec.close(); console.log(`saved ${rec.records.length} packets to ${out}`); }
process.exit(0);
