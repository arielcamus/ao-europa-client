// AGPL-3.0-or-later. Records a party (group) lifecycle between TWO characters against the VB6 server as two conformance fixtures
// (docs/CONFORMANCE.md format): the leader's session and the member's session.
// Usage: AO_LEADER_EMAIL=.. AO_LEADER_PASSWORD=.. AO_MEMBER_EMAIL=.. AO_MEMBER_PASSWORD=.. [AO_MEMBER_CHAR=Name] \
//        node tools/real-server/record-party.mjs <out-prefix>      -> <prefix>-leader.jsonl and <prefix>-member.jsonl
// Steps: member walks next to the leader and turns the party safe off; leader RequestGrupo, InvitarGrupo, WorkLeftClick (skill Grupo=90) on the
// member; member declines; invite again and accept; both RequestGrupo; leader expels the member (HecharDeGrupo); invite and accept once more;
// the member leaves (AbandonarGrupo). Needs the VB6 server on 127.0.0.1:7667, two level-1 characters of the same faction.
import { Recorder } from '../conformance/vb6-record.mjs';
import { str, i32 } from '../conformance/wire.mjs';
import { makeWalker } from '../conformance/helpers.mjs';
import { decodeServerPacket } from '../../packages/protocol/dist/index.js';

const need = name => process.env[name] ?? (() => { throw new Error(`Set ${name}`); })();
const prefix = process.argv[2]; if (!prefix) throw new Error('usage: record-party.mjs <out-prefix>');
async function login(email, password, wanted) {
  const rec = new Recorder(process.env.AO_HOST ?? '127.0.0.1', Number(process.env.AO_PORT ?? 7667));
  await rec.wait(r => r.id === 1);
  rec.send(305, [...str(email), ...str(password)]);
  const list = await rec.wait(r => r.id === 199);
  const chars = decodeServerPacket(Uint8Array.from(Buffer.from(list.hex, 'hex'))).characters;
  const pick = chars.find(c => c.name === (wanted ?? chars[0].name)); if (!pick) throw new Error(`no character ${wanted}`);
  rec.send(73, [...i32(pick.id), ...str(pick.name)]);
  await rec.wait(r => r.id === 2); await rec.sleep(1500);
  const self = Buffer.from(rec.records.find(r => r.name === 'UserCharIndexInServer').hex, 'hex').readInt16LE(2);
  const cc = rec.records.filter(r => r.name === 'CharacterCreate').map(r => Buffer.from(r.hex, 'hex')).find(b => b.readInt16LE(2) === self);
  return { rec, name: pick.name, pos: [cc[9], cc[10]], work: 0 };
}
const next = (u, id) => { const at = u.rec.records.length; return { wait: (ms = 6000) => u.rec.wait(r => r.id === id && u.rec.records.indexOf(r) >= at, ms).catch(error => { throw new Error(`timeout waiting for s2c ${id} (${u.name}); last ids ${u.rec.records.slice(-8).map(r => r.id)}`, { cause: error }); }) }; };
const leader = await login(need('AO_LEADER_EMAIL'), need('AO_LEADER_PASSWORD'));
const member = await login(need('AO_MEMBER_EMAIL'), need('AO_MEMBER_PASSWORD'), process.env.AO_MEMBER_CHAR);
try {
  const walker = makeWalker(member.rec);
  if (!await walker.goto([leader.pos[0] + 1, leader.pos[1]])) throw new Error('member could not reach the leader');
  const target = walker.pos;
  const safeOff = next(member, 23); member.rec.send(83); await safeOff.wait().catch(() => console.log('party safe was already off'));
  const invite = async () => {
    leader.rec.send(236); await next(leader, 143).wait(); // RequestGrupo -> DatosGrupo
    const ask = next(member, 142); const t = next(leader, 62);
    leader.rec.send(234); await t.wait();                  // InvitarGrupo -> WorkRequestTarget(Grupo)
    leader.rec.send(2, [target[0], target[1], 90, ...i32(++leader.work)]); await ask.wait(); // WorkLeftClick -> ShowPregunta on the member
  };
  await invite(); member.rec.send(235, [0]); await leader.rec.sleep(1200);              // decline
  await invite(); const joined = next(leader, 193); member.rec.send(235, [1]); await joined.wait(); await leader.rec.sleep(1000); // accept
  leader.rec.send(236); await next(leader, 143).wait(); member.rec.send(236); await next(member, 143).wait();
  const gone = next(member, 193); leader.rec.send(238, [1]); await gone.wait().catch(() => undefined); await leader.rec.sleep(1200); // expel member (index 1)
  await invite(); const again = next(leader, 193); member.rec.send(235, [1]); await again.wait(); await leader.rec.sleep(1000);
  member.rec.send(237); await leader.rec.sleep(1500);                                       // member leaves
  leader.rec.send(236); await next(leader, 143).wait();
} finally {
  leader.rec.save(`${prefix}-leader.jsonl`); member.rec.save(`${prefix}-member.jsonl`);
  console.log(`saved ${leader.rec.records.length} + ${member.rec.records.length} packets; leader=${leader.name} member=${member.name}`);
  leader.rec.close(); member.rec.close();
}
process.exit(0);
