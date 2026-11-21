// AGPL-3.0-or-later. One-shot GM helper for the windows work package: sends GM EditChar / GiveItem as Aotest.
// Usage: node tools/windows-gm.mjs mod <Name> <ORO|LEVEL|...> <value> | give <Name> <obj> [amount]
import { Recorder } from './conformance/vb6-record.mjs';
import { str, i32 } from './conformance/wire.mjs';
import { decodeServerPacket, encodeClientPacket, GmClientPacketId as GM } from '../packages/protocol/dist/index.js';
const [command, name, a, b] = process.argv.slice(2);
const options = { ORO: 1, EXP: 2, LEVEL: 7, SKILLS: 9 };
for (let attempt = 0; attempt < 8; attempt++) {
  const rec = new Recorder('127.0.0.1', 7667);
  await rec.wait(r => r.id === 1);
  rec.send(305, [...str('aotest@local.test'), ...str('aotestpw1')]);
  const list = await rec.wait(r => r.id === 199);
  const pick = decodeServerPacket(Uint8Array.from(Buffer.from(list.hex, 'hex'))).characters.find(c => c.name === 'Aotest');
  rec.send(73, [...i32(pick.id), ...str(pick.name)]);
  const ok = await rec.wait(r => r.id === 2, 8000).then(() => true, () => false);
  if (!ok) { rec.close(); await new Promise(r => setTimeout(r, 15000)); continue; }
  await rec.sleep(2000);
  const packet = command === 'mod' ? { id: GM.EditChar, userName: name, editOption: options[a], arg1: String(b), arg2: '' }
    : { id: GM.GiveItem, userName: name, objIndex: Number(a), cantidad: Number(b ?? 1), motivo: 'windows-test' };
  rec.send(packet.id, [...encodeClientPacket(packet).slice(2)]); await rec.sleep(1500); rec.close();
  console.log('sent', command, name, a, b); process.exit(0);
}
console.error('Aotest never logged in'); process.exit(1);
